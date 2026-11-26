import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { configuration } from '@/configuration'
import { Doorbells } from './runner'
import { supervisor } from './scripts'

const python = process.platform === 'win32' ? 'python' : 'python3'
const hasPython = spawnSync(python, ['--version']).status === 0

test.skipIf(!hasPython)('runs a shebang-free SDK monitor, retries it, and delivers a ring', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hamlet-doorbell-'))
    const cwd = join(await realpath(home), 'agent dir')
    const doorbells = new Doorbells()
    const requests: unknown[] = []
    const server = createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        requests.push([req.method, req.url, req.headers.authorization, JSON.parse(Buffer.concat(chunks).toString())])
        res.setHeader('Content-Type', 'application/json')
        res.end('{}')
    })
    const id = 'sdk-probe'
    const revision = '1'
    try {
        await mkdir(cwd)
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (address === null || typeof address === 'string') throw new Error('Expected a TCP address')
        vi.spyOn(configuration, 'happyHomeDir', 'get').mockReturnValue(home)
        vi.spyOn(configuration, 'apiUrl', 'get').mockReturnValue(`http://127.0.0.1:${address.port}`)
        await doorbells.reconcile({
            revision,
            bells: [{
                id,
                owner: 'agent',
                name: 'SDK probe',
                directory: cwd,
                token: 'test-token',
                script: `from doorbell import every, ring, state
from pathlib import Path

if not state.get("started"):
    state.set("started", True)
    raise RuntimeError("intentional first-run failure")

@every(seconds=60)
def check():
    ring(prompt=Path.cwd().name, dedup_key="sdk-probe")
`,
            }],
        })
        await vi.waitFor(async () => {
            expect(await doorbells.reconcile({ revision })).toEqual([{ id, status: 'backoff', error: 'Monitor exited: 1' }])
        })
        expect((await doorbells.log(id)).log).toContain('RuntimeError: intentional first-run failure')
        await vi.waitFor(async () => {
            await doorbells.reconcile({ revision })
            expect(requests).toEqual([['POST', '/hamlet/ring', 'Bearer test-token', {
                prompt: 'agent dir',
                dedup_key: 'sdk-probe',
            }]])
        }, { timeout: 5000 })
    } finally {
        await doorbells.reconcile({ revision, bells: [] })
        doorbells.close()
        vi.restoreAllMocks()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await rm(home, { recursive: true, force: true })
    }
}, 10_000)

test.skipIf(!hasPython || process.platform === 'win32')('logs a failed explicit interpreter launch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hamlet-doorbell-'))
    const script = join(dir, 'monitor')
    const log = join(dir, 'output.log')
    try {
        await writeFile(script, '#!/nonexistent-doorbell-interpreter\n', { mode: 0o700 })
        const result = spawnSync(python, ['-u', '-c', supervisor, script, log], { timeout: 3000 })
        expect(result.status).toBe(1)
        expect(await readFile(log, 'utf8')).toContain('FileNotFoundError:')
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
