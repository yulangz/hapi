import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    readSharedCursorModelsCache,
    writeSharedCursorModelsCache,
    _resetSharedCursorModelsCacheForTests
} from './cursorModelsSharedCache';

// Isolate the on-disk cursor-models cache to this file's own HAMLET_HOME so
// parallel vitest workers don't race on the shared $HAMLET_HOME/cache path
// (see heavygee/hamlet#101).
const previousHamletHome = process.env.HAMLET_HOME;
const testHamletHome = mkdtempSync(join(tmpdir(), 'hamlet-cursor-models-shared-cache-'));
process.env.HAMLET_HOME = testHamletHome;

afterEach(() => {
    _resetSharedCursorModelsCacheForTests();
});

// Remove the per-file temp root after the suite so runs don't leak dirs into
// the system temp dir (afterEach only clears the cache file inside it).
afterAll(() => {
    if (previousHamletHome === undefined) delete process.env.HAMLET_HOME;
    else process.env.HAMLET_HOME = previousHamletHome;
    rmSync(testHamletHome, { recursive: true, force: true });
});

describe('cursorModelsSharedCache', () => {
    test('round-trips a usable models response', () => {
        const payload = {
            success: true as const,
            availableModels: [{ modelId: 'composer-2.5[fast=true]', name: 'composer-2.5' }],
            currentModelId: 'composer-2.5[fast=true]'
        };

        writeSharedCursorModelsCache(payload);

        expect(readSharedCursorModelsCache()).toEqual(payload);
    });

    test('ignores empty or invalid cache files', () => {
        writeSharedCursorModelsCache({ success: true, availableModels: [], currentModelId: null });
        expect(readSharedCursorModelsCache()).toBeNull();
    });

    test('round-trips cliModelSkus with wire catalog', () => {
        const payload = {
            success: true as const,
            availableModels: [{ modelId: 'gpt-5.5[context=272k,reasoning=medium,fast=false]', name: 'gpt-5.5' }],
            currentModelId: 'gpt-5.5[context=272k,reasoning=medium,fast=false]',
            cliModelSkus: [
                { modelId: 'gpt-5.5-medium', name: 'GPT-5.5 1M' }
            ]
        };

        writeSharedCursorModelsCache(payload);

        expect(readSharedCursorModelsCache()?.cliModelSkus).toEqual(payload.cliModelSkus);
    });
});
