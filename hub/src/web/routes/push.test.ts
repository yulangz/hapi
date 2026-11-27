import { Database } from 'bun:sqlite'
import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { Store } from '../../store'
import { createAuthMiddleware, type WebAppEnv } from '../middleware/auth'
import { createPushRoutes } from './push'

it('assigns an endpoint to its authenticated owner and repairs ambiguous legacy subscriptions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hamlet-push-test-'))
    const dbPath = join(dir, 'hub.db')
    const store = new Store(dbPath)
    const legacy = new Database(dbPath)
    const secret = new TextEncoder().encode('push-route-test-secret')
    const app = new Hono<WebAppEnv>()
    app.use('/api/*', createAuthMiddleware(secret))
    app.route('/api', createPushRoutes(store, 'test-vapid'))
    const endpoint = 'https://push.example.test/shared-browser'
    const keys = { p256dh: 'browser-key', auth: 'browser-auth' }
    async function request(path: string, namespace: string, body: object, method = 'POST') {
        const token = await new SignJWT({ uid: 1, ns: namespace })
            .setProtectedHeader({ alg: 'HS256' }).sign(secret)
        return app.request('/api/push/' + path, {
            method,
            headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })
    }
    try {
        expect((await app.request('/api/push/subscribe', { method: 'POST' })).status).toBe(401)
        expect((await request('subscribe', 'alpha', { endpoint, keys })).status).toBe(200)
        expect(store.push.getPushSubscriptionsByNamespace('alpha')).toEqual([expect.objectContaining({ endpoint, ...keys })])
        expect(store.push.getPushSubscriptionsByNamespace('beta')).toEqual([])

        legacy.prepare('INSERT INTO push_subscriptions (namespace, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)')
            .run('beta', endpoint, keys.p256dh, keys.auth, 1)
        for (const namespace of ['alpha', 'beta']) {
            expect(store.push.getPushSubscriptionsByNamespace(namespace)).toEqual([])
        }

        expect((await request('subscribe', 'beta', { endpoint, keys })).status).toBe(200)
        expect((await request('subscribe', 'alpha', { endpoint }, 'DELETE')).status).toBe(200)
        expect(store.push.getPushSubscriptionsByNamespace('alpha')).toEqual([])
        expect(store.push.getPushSubscriptionsByNamespace('beta')).toEqual([expect.objectContaining({ endpoint, ...keys })])
    } finally {
        legacy.close()
        store.close()
        rmSync(dir, { recursive: true, force: true })
    }
})
