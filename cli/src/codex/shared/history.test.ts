import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readPagedTurns, rolloutHasDeveloperPrompt } from './history';

describe('paged native history', () => {
    it('restarts with full one-turn pages when a legacy server rejects item paging', async () => {
        const request = vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
            if (method === 'thread/items/list') throw new Error('thread/items/list is not supported yet');
            if (params.itemsView === 'summary') return { data: [{ id: 't1', items: [] }], nextCursor: 'summary-cursor' };
            expect(params.limit).toBe(1);
            return params.cursor
                ? { data: [{ id: 't2', items: [{ type: 'agentMessage', id: 'reply' }] }] }
                : { data: [{ id: 't1', items: [{ type: 'userMessage', id: 'prompt' }] }], nextCursor: 'full-cursor' };
        });
        expect(await readPagedTurns({ request }, 'root')).toEqual([
            { id: 't1', items: [{ type: 'userMessage', id: 'prompt' }] },
            { id: 't2', items: [{ type: 'agentMessage', id: 'reply' }] }
        ]);
        expect(request).toHaveBeenCalledWith('thread/turns/list', { threadId: 'root', cursor: undefined, limit: 1, sortDirection: 'asc', itemsView: 'full' });
        expect(request).toHaveBeenCalledWith('thread/turns/list', { threadId: 'root', cursor: 'full-cursor', limit: 1, sortDirection: 'asc', itemsView: 'full' });
    });

    it('does not mask transport failures as unavailable item paging', async () => {
        const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 't1' }] }).mockRejectedValueOnce(new Error('Connection closed'));
        await expect(readPagedTurns({ request }, 'root')).rejects.toThrow('Connection closed');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('rejects incomplete full-turn fallback data', async () => {
        const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 't1' }] })
            .mockRejectedValueOnce(new Error('thread/items/list is not supported yet'))
            .mockResolvedValueOnce({ data: [{ id: 't1' }] });
        await expect(readPagedTurns({ request }, 'root')).rejects.toThrow('full turn history items');
    });

    it('loads turn summaries and independent item pages without requesting full-history hydration', async () => {
        const request = vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
            if (method === 'thread/turns/list') return params.cursor
                ? { data: [{ id: 't2', status: 'inProgress', items: ['summary only'] }], nextCursor: null }
                : { data: [{ id: 't1', status: 'completed' }], nextCursor: 'next-turn' };
            if (method === 'thread/items/list') return params.turnId === 't2'
                ? { data: [], nextCursor: null }
                : params.cursor ? { data: [{ turnId: 't1', item: { id: 'b', type: 'agentMessage' }, completedAtMs: 123 }], nextCursor: null }
                    : { data: [{ turnId: 't1', item: { id: 'a', type: 'userMessage' }, startedAtMs: 100 }], nextCursor: 'next-item' };
            throw new Error('Unbounded history request');
        });
        expect(await readPagedTurns({ request }, 'root')).toEqual([
            { id: 't1', status: 'completed', items: [{ id: 'a', type: 'userMessage' }, { id: 'b', type: 'agentMessage' }] },
            { id: 't2', status: 'inProgress', items: [] }
        ]);
        expect(request).toHaveBeenCalledWith('thread/turns/list', { threadId: 'root', cursor: 'next-turn', limit: 20, sortDirection: 'asc', itemsView: 'summary' });
        expect(request).toHaveBeenCalledWith('thread/items/list', { threadId: 'root', turnId: 't1', cursor: 'next-item', limit: 20, sortDirection: 'asc' });
    });

    it('handles an empty thread', async () => {
        expect(await readPagedTurns({ request: vi.fn().mockResolvedValue({ data: [] }) }, 'empty')).toEqual([]);
    });

    it.each([
        [{}, 'turn history page'],
        [{ data: [{}] }, 'no turn ID']
    ])('rejects invalid turn data instead of silently dropping history (%s)', async (response, message) => {
        await expect(readPagedTurns({ request: vi.fn().mockResolvedValue(response) }, 'root')).rejects.toThrow(String(message));
    });

    it('rejects an invalid item page', async () => {
        const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'turn' }] }).mockResolvedValueOnce({});
        await expect(readPagedTurns({ request }, 'root')).rejects.toThrow('item history page');
    });

    it('rejects malformed entries instead of replaying empty items', async () => {
        const request = vi.fn().mockResolvedValueOnce({ data: [{ id: 'turn' }] }).mockResolvedValueOnce({ data: [{ id: 'bare-item', type: 'agentMessage' }] });
        await expect(readPagedTurns({ request }, 'root')).rejects.toThrow('item history entry');
    });
});

it('detects the exact developer prompt in the current native history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hamlet-rollout-prompt-'));
    const path = join(directory, 'rollout.jsonl');
    const prompt = 'Current main Agent instructions';
    const message = (role: string, text: string) => ({
        type: 'message', role, content: [{ type: 'input_text', text }]
    });
    const item = (role: string, text: string) => ({ type: 'response_item', payload: message(role, text) });
    const compact = (...items: unknown[]) => ({ type: 'compacted', payload: { replacement_history: items } });
    async function write(...entries: unknown[]) {
        await writeFile(path, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    }
    try {
        await expect(rolloutHasDeveloperPrompt(path, prompt)).rejects.toMatchObject({ code: 'ENOENT' });
        const old = [item('developer', prompt + ' (previous revision)'), item('user', prompt), item('assistant', prompt)];
        await write(...old);
        expect(await rolloutHasDeveloperPrompt(path, prompt)).toBe(false);
        const current = item('developer', prompt);
        await write(...old, current, item('user', 'Follow-up'));
        expect(await rolloutHasDeveloperPrompt(path, prompt)).toBe(true);
        await write(...old, current, compact(message('user', prompt)));
        expect(await rolloutHasDeveloperPrompt(path, prompt)).toBe(false);
        await write(...old, current, compact(message('developer', prompt)));
        expect(await rolloutHasDeveloperPrompt(path, prompt)).toBe(true);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
