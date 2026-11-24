import { Hono } from 'hono'
import { join } from 'node:path'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import installer from '../../../scripts/runner/install.py' with { type: 'text' }

import launcher from '../../../scripts/runner/hamlet' with { type: 'text' }

export function createRunnerInstallRoutes(directory: string, cliToken: string, jwtSecret: Uint8Array) {
    const routes = new Hono<WebAppEnv>()
    const authenticateSession = createAuthMiddleware(jwtSecret)
    routes.use('*', async (c, next) => {
        c.header('Cache-Control', 'private, no-store')
        const authorization = c.req.header('Authorization')
        const raw = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
        if (raw && constantTimeEquals(parseAccessToken(raw)?.baseToken, cliToken)) return next()
        return authenticateSession(c, next)
    })
    routes.get('/install.py', c => {
        c.header('Content-Disposition', 'attachment; filename="install.py"')
        return c.text(installer)
    })
    routes.get('/hamlet', c => c.text(launcher))
    routes.get('/:asset', async c => {
        const name = c.req.param('asset')
        if (!/^hamlet-runner-(darwin|linux)-(arm64|x64)\.gz(?:\.sha256)?$/.test(name)) return c.notFound()
        const file = Bun.file(join(directory, name))
        if (!await file.exists()) return c.notFound()
        return new Response(file, { headers: { 'Content-Length': String(file.size), 'Content-Type': name.endsWith('.sha256') ? 'text/plain' : 'application/gzip', 'Cache-Control': 'private, no-store' } })
    })
    return routes
}
