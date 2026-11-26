import { describe, expect, it, mock, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentConfig } from '@hamlet/protocol/hamlet'
import type { AgentNotificationSender } from '../notifications/notificationTypes'
import { RpcRegistry } from '../socket/rpcRegistry'
import { Store } from '../store'
import { SyncEngine } from '../sync/syncEngine'
import { hamletRoutes } from './routes'

const config = AgentConfig.parse({
    machine_id: 'machine', directory: '/work', name: 'Fixture', description: 'Fixture', prompt: 'Fixture'
})
const payload = { request_id: 'review-ready', text: 'Review is ready' }

function start(store: Store, send: AgentNotificationSender) {
    const engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never, send)
    const app = hamletRoutes(() => engine)
    return {
        engine,
        notify: (token: string, input: unknown = payload) => app.request('/tool/notify', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        })
    }
}

function register(store: Store, engine: SyncEngine, namespace: string, parent: string | null = null) {
    const agent = store.hamlet.register(namespace, parent, parent ? 'child' : 'main', config)
    engine.getOrCreateSession('hamlet:' + agent.id, {}, null, namespace, undefined, undefined, undefined, agent.id)
    return agent
}

describe('authenticated notify tool', () => {
    it('blocks children and invalid recipients, joins concurrent retries and isolates accounts', async () => {
        const store = new Store(':memory:')
        store.machines.getOrCreateMachine('machine', {}, null, 'alpha')
        const send = mock<AgentNotificationSender>(async () => 'dispatched')
        let release!: () => void
        const held = new Promise<void>(resolve => { release = resolve })
        send.mockImplementationOnce(async () => {
            await held
            return 'dispatched'
        })
        const { engine, notify } = start(store, send)
        try {
            const alpha = register(store, engine, 'alpha')
            const child = register(store, engine, 'alpha', alpha.id)
            const beta = register(store, engine, 'beta')
            expect((await notify('invalid')).status).toBe(401)
            expect((await notify(child.token)).status).toBe(403)
            expect((await notify(alpha.token, { ...payload, namespace: 'beta' })).status).toBe(400)
            expect((await notify(alpha.token, { ...payload, text: ' ' })).status).toBe(400)
            expect(send).not.toHaveBeenCalled()

            const pending = [notify(alpha.token), notify(alpha.token)]
            release()
            const responses = await Promise.all(pending)
            expect(responses.map(response => response.status)).toEqual([200, 200])
            const [first, retry] = await Promise.all(responses.map(async response => {
                return await response.json() as { status: string; notification_id: string }
            }))
            expect(first).toEqual({ status: 'dispatched', notification_id: expect.any(String) })
            expect(retry).toEqual(first)
            expect(send.mock.calls).toHaveLength(1)
            expect(send.mock.calls[0]).toEqual([
                expect.objectContaining({ id: alpha.id, namespace: 'alpha' }),
                { id: first.notification_id, text: payload.text }
            ])
            expect((await notify(alpha.token, { ...payload, text: 'Changed' })).status).toBe(400)
            const other = await notify(beta.token)
            expect(other.status).toBe(200)
            expect(await other.json()).toMatchObject({ status: 'dispatched' })
            expect(send.mock.calls[1][0].namespace).toBe('beta')
            expect(send.mock.calls[1][1].id).not.toBe(first.notification_id)
        } finally {
            release()
            engine.stop()
            store.close()
        }
    })

    it('migrates a v29 DB and preserves successful, failed and indeterminate outcomes across restart', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'hamlet-notify-test-'))
        const dbPath = join(directory, 'hub.db')
        let store = new Store(dbPath)
        const legacy = new Database(dbPath)
        legacy.exec('DROP TABLE hamlet_notification_requests; PRAGMA user_version = 29')
        legacy.close()
        store.close()
        store = new Store(dbPath)
        store.machines.getOrCreateMachine('machine', {}, null, 'alpha')
        const send = mock<AgentNotificationSender>(async () => 'dispatched')
        const first = start(store, send)
        const failed = { request_id: 'failed', text: 'Unable to dispatch' }
        const interrupted = { request_id: 'interrupted', text: 'Interrupted dispatch' }
        const timedOut = { request_id: 'timed-out', text: 'Unknown transport outcome' }
        const unknown = { error: expect.stringContaining('outcome is unknown') }
        try {
            const agent = register(store, first.engine, 'alpha')
            const initial = await first.notify(agent.token)
            expect(initial.status).toBe(200)
            const delivered = await initial.json()

            send.mockResolvedValueOnce('retryable')
            const failure = await first.notify(agent.token, failed)
            expect(await failure.json()).toEqual({ error: 'No notification route accepted delivery. Retry with the same request_id.' })
            const failedId = send.mock.calls[1][1].id
            send.mockResolvedValueOnce('unknown')
            expect(await (await first.notify(agent.token, timedOut)).json()).toEqual(unknown)

            const persist = spyOn(store.hamlet, 'finishNotification').mockImplementationOnce(() => {
                throw new Error('simulated DB write interruption')
            })
            try {
                expect(await (await first.notify(agent.token, interrupted)).json()).toEqual(unknown)
            } finally { persist.mockRestore() }
            first.engine.stop()
            store.close()

            store = new Store(dbPath)
            const second = start(store, send)
            try {
                expect(await (await second.notify(agent.token)).json()).toEqual(delivered)
                expect(await (await second.notify(agent.token, timedOut)).json()).toEqual(unknown)
                expect(await (await second.notify(agent.token, interrupted)).json()).toEqual(unknown)
                const retries = await Promise.all([second.notify(agent.token, failed), second.notify(agent.token, failed)])
                const retried = { status: 'dispatched', notification_id: failedId }
                for (const response of retries) expect(await response.json()).toEqual(retried)
                expect(await (await second.notify(agent.token, failed)).json()).toEqual(retried)
                expect(send.mock.calls).toHaveLength(5)
            } finally { second.engine.stop() }
        } finally {
            first.engine.stop()
            store.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
