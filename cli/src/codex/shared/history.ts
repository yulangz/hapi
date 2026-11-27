import { record, string } from './gateway';

type HistoryClient = { request(method: string, params: Record<string, unknown>): Promise<unknown> };

function lacksItemPaging(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /thread\/items\/list.*(?:not supported|not implemented|unsupported)|(?:method not found|unknown method).*thread\/items\/list/i.test(message);
}

/** Legacy threads on Codex 0.166 expose full turn pages, but not item pages. */
async function readFullTurnPages(client: HistoryClient, threadId: string): Promise<unknown[]> {
    const turns: unknown[] = [];
    let cursor: string | undefined;
    do {
        const page = record(await client.request('thread/turns/list', {
            threadId, cursor, limit: 1, sortDirection: 'asc', itemsView: 'full'
        }));
        if (!Array.isArray(page.data)) throw new Error('Invalid Codex full turn history page');
        for (const value of page.data) {
            const turn = record(value);
            if (!string(turn.id)) throw new Error('Codex turn history has no turn ID');
            if (!Array.isArray(turn.items) || turn.items.some(item => typeof record(item).type !== 'string')) {
                throw new Error('Invalid Codex full turn history items');
            }
            turns.push(turn);
        }
        cursor = string(page.nextCursor);
    } while (cursor);
    return turns;
}

/** Prefer independent item pages; legacy-only servers need one full turn per response. */
export async function readPagedTurns(client: HistoryClient, threadId: string): Promise<unknown[]> {
    const turns: unknown[] = [];
    let cursor: string | undefined;
    do {
        const page = record(await client.request('thread/turns/list', {
            threadId, cursor, limit: 20, sortDirection: 'asc', itemsView: 'summary'
        }));
        if (!Array.isArray(page.data)) throw new Error('Invalid Codex turn history page');
        for (const value of page.data) {
            const turn = record(value);
            const turnId = string(turn.id);
            if (!turnId) throw new Error('Codex turn history has no turn ID');
            const items: unknown[] = [];
            let itemCursor: string | undefined;
            do {
                let itemPage: Record<string, unknown>;
                try {
                    itemPage = record(await client.request('thread/items/list', {
                        threadId, turnId, cursor: itemCursor, limit: 20, sortDirection: 'asc'
                    }));
                } catch (error) {
                    if (lacksItemPaging(error)) return readFullTurnPages(client, threadId);
                    throw error;
                }
                if (!Array.isArray(itemPage.data)) throw new Error('Invalid Codex item history page');
                for (const entry of itemPage.data) {
                    const item = record(entry).item;
                    if (typeof record(item).type !== 'string') throw new Error('Invalid Codex item history entry');
                    items.push(item);
                }
                itemCursor = string(itemPage.nextCursor);
            } while (itemCursor);
            turns.push({ ...turn, items });
        }
        cursor = string(page.nextCursor);
    } while (cursor);
    return turns;
}
