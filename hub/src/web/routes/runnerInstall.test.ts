import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunnerInstallRoutes } from './runnerInstall'

test('serves the installer and only the published Runner assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runner-dist-'))
    try {
        const routes = createRunnerInstallRoutes(dir, 'test-access', new Uint8Array(32))
        const headers = { Authorization: 'Bearer test-access' }
        for (const name of ['install.py', 'hamlet', 'hamlet-linux-arm64.gz.sha256', 'hamlet-runner-linux-x64.gz']) {
            expect((await routes.request('/' + name)).status).toBe(401)
            expect((await routes.request('/' + name, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401)
        }
        const checksum = 'hamlet-runner-linux-arm64.gz.sha256'
        await writeFile(join(dir, checksum), 'expected sum')
        await writeFile(join(dir, 'settings.json'), 'private')
        expect(await (await routes.request('/install.py', { headers })).text()).toContain('def install()')
        expect(await (await routes.request('/' + checksum, { headers })).text()).toBe('expected sum')
        expect((await routes.request('/hamlet-runner-linux-arm64.gz', { headers })).status).toBe(404)
        expect((await routes.request('/settings.json', { headers })).status).toBe(404)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
