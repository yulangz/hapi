import { record, string } from './gateway';

type HistoryClient = { request(method: string, params: Record<string, unknown>): Promise<unknown> };

/** Bound each transport response even when one turn contains months of tools. */
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
                const itemPage = record(await client.request('thread/items/list', {
                    threadId, turnId, cursor: itemCursor, limit: 20, sortDirection: 'asc'
                }));
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
