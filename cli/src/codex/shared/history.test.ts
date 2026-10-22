import { describe, expect, it, vi } from 'vitest';
import { readPagedTurns } from './history';

describe('paged native history', () => {
    it('loads turn summaries and independent item pages without requesting full-history hydration', async () => {
        const request = vi.fn(async (method: string, params: Record<string, unknown>): Promise<unknown> => {
            if (method === 'thread/turns/list') return params.cursor
                ? { data: [{ id: 't2', status: 'inProgress', items: ['summary only'] }], nextCursor: null }
                : { data: [{ id: 't1', status: 'completed' }], nextCursor: 'next-turn' };
            if (method === 'thread/items/list') return params.turnId === 't2'
                ? { data: [], nextCursor: null }
                : params.cursor ? { data: [{ id: 'b' }], nextCursor: null }
                    : { data: [{ id: 'a' }], nextCursor: 'next-item' };
            throw new Error('Unbounded history request');
        });
        expect(await readPagedTurns({ request }, 'root')).toEqual([
            { id: 't1', status: 'completed', items: [{ id: 'a' }, { id: 'b' }] },
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
});
