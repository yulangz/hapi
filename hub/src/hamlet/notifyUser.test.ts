import { expect, it, mock, spyOn } from 'bun:test'
import { AgentConfig } from '@hamlet/protocol/hamlet'
import { AgentNotificationQueue } from '../notifications/agentNotificationQueue'
import { RpcRegistry } from '../socket/rpcRegistry'
import { Store } from '../store'
import { SyncEngine } from '../sync/syncEngine'
import { hamletRoutes } from './routes'

it('authenticates the main Agent and queues a Unicode-limited notification without waiting for delivery', async () => {
    const store = new Store(':memory:')
    store.machines.getOrCreateMachine('machine', {}, null, 'alpha')
    const config = AgentConfig.parse({
        machine_id: 'machine', directory: '/work', name: 'Fixture', description: 'Fixture', prompt: 'Fixture'
    })
    const send = mock(async () => false)
    const engine: SyncEngine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never,
        (agent, requestId, text) => queue.enqueue(agent, requestId, text))
    const queue: AgentNotificationQueue = new AgentNotificationQueue(store.hamlet, engine, new Map([['browser', send]]))
    const app = hamletRoutes(() => engine)
    const payload = { request_id: 'review-ready', text: '𠮷'.repeat(60) }
    function register(namespace: string, parent: string | null = null) {
        const agent = store.hamlet.register(namespace, parent, parent ? 'child' : 'main', config)
        engine.getOrCreateSession('hamlet:' + agent.id, {}, null, namespace, undefined, undefined, undefined, agent.id)
        return agent
    }
    function notify(token: string, input: unknown = payload, tool = 'notify_user') {
        return app.request('/tool/' + tool, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        })
    }

    const log = spyOn(console, 'warn').mockImplementation(() => {})
    try {
        const alpha = register('alpha')
        const beta = register('beta')
        const child = register('alpha', alpha.id)
        expect((await notify('invalid')).status).toBe(401)
        expect((await notify(alpha.token, payload, 'notify')).status).toBe(404)
        expect((await notify(child.token)).status).toBe(403)
        expect((await notify(alpha.token, { ...payload, namespace: 'beta' })).status).toBe(400)
        expect((await notify(alpha.token, { ...payload, text: ' ' })).status).toBe(400)
        expect((await notify(alpha.token, { ...payload, text: payload.text + '字' })).status).toBe(400)

        const [first, duplicate] = await Promise.all([notify(alpha.token), notify(alpha.token)])
        expect(first.status).toBe(200)
        expect(duplicate.status).toBe(200)
        const accepted = await first.json() as { status: string; notification_id: string }
        expect(accepted).toMatchObject({ status: 'queued', notification_id: expect.any(String) })
        expect(await duplicate.json()).toEqual(accepted)
        expect(send).not.toHaveBeenCalled()
        expect((await notify(alpha.token, { ...payload, text: 'Changed' })).status).toBe(400)
        const other = await (await notify(beta.token)).json() as typeof accepted
        expect(other.notification_id).not.toBe(accepted.notification_id)

        await queue.runDue()
        expect(send).toHaveBeenCalledTimes(2)
        expect(await (await notify(alpha.token)).json()).toEqual(accepted)
        expect(send).toHaveBeenCalledTimes(2)
    } finally {
        log.mockRestore()
        await queue.stop()
        engine.stop()
        store.close()
    }
})
