import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: readFileSyncMock }));

import { getHapiRunnerProcessIdentity, getProcessStartMarker, isProcessAlive } from './process';

const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('Linux process liveness', () => {
    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        vi.spyOn(process, 'kill').mockReturnValue(true);
        readFileSyncMock.mockReset();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'platform', descriptor);
    });

    it.each(['Z', 'X', 'x'])('treats unreaped/dead state %s as exited even when signal 0 succeeds', state => {
        readFileSyncMock.mockReturnValue(`489121 (hapi) ${state} 1 1 1 0`);
        expect(isProcessAlive(489121)).toBe(false);
        expect(getProcessStartMarker(489121)).toBeNull();
        expect(getHapiRunnerProcessIdentity(489121)).toBe('dead');
    });

    it.each(['R', 'S', 'D', 'T', 't'])('preserves ownership for a live process in state %s', state => {
        readFileSyncMock.mockReturnValue(`123 (name with ) Z inside) ${state} 1 1 1 0`);
        expect(isProcessAlive(123)).toBe(true);
        expect(readFileSyncMock).toHaveBeenCalledWith('/proc/123/stat', 'utf8');
    });

    it.each(['ENOENT', 'ESRCH'])('handles exit between the signal and procfs probes (%s)', code => {
        readFileSyncMock.mockImplementation(() => { throw Object.assign(new Error('gone'), { code }); });
        expect(isProcessAlive(123)).toBe(false);
    });

    it.each(['EACCES', 'EPERM', 'EIO'])('does not release ownership when procfs cannot be read (%s)', code => {
        readFileSyncMock.mockImplementation(() => { throw Object.assign(new Error('unreadable'), { code }); });
        expect(isProcessAlive(123)).toBe(true);
    });

    it('retains a successful signal probe when procfs data is malformed', () => {
        readFileSyncMock.mockReturnValue('unexpected contents');
        expect(isProcessAlive(123)).toBe(true);
    });

    it('does not read procfs for an absent process', () => {
        vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
        expect(isProcessAlive(123)).toBe(false);
        expect(readFileSyncMock).not.toHaveBeenCalled();
    });

    it('keeps other platforms on the existing signal probe', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        expect(isProcessAlive(123)).toBe(true);
        expect(readFileSyncMock).not.toHaveBeenCalled();
    });
});
