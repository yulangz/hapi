import { expect, it, mock, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentConfig } from '@hamlet/protocol/hamlet'
import { Store } from '../store'
import type { Session } from '../sync/syncEngine'
import { AgentNotificationQueue } from './agentNotificationQueue'
import type { AgentNotificationSender } from './notificationTypes'

const start = 1_700_000_000_000

function main(store: Store) {
    store.machines.getOrCreateMachine('machine', {}, null, 'scope')
    const row = store.hamlet.register('scope', null, 'main', AgentConfig.parse({
        machine_id: 'machine', directory: '/work', name: 'Main', description: 'Fixture', prompt: 'Fixture',
    }))
    return { id: row.id, namespace: row.namespace, hamletMain: true } as Session
}

function engine(session: Session) {
    return {
        getSessionByNamespace(id: string, namespace: string) {
            expect(id).toBe(session.id)
            expect(namespace).toBe(session.namespace)
            return session
        }
    }
}

it('backs off per channel, keeps successful channels terminal, and counts the initial attempt in the limit', async () => {
    const store = new Store(':memory:')
    const log = spyOn(console, 'warn').mockImplementation(() => {})
    try {
        const session = main(store)
        const success = mock<AgentNotificationSender>(async () => true)
        const failure = mock<AgentNotificationSender>(async () => false)
        const queue = new AgentNotificationQueue(store.hamlet, engine(session), new Map([
            ['browser', failure], ['simulated', success]
        ]))
        const id = store.hamlet.enqueueNotification(session.id, 'notice', 'Review is ready', ['browser', 'simulated'], start)
        const expected = [0, 10, 30, 70, 150, 310, 630, 1270, 2550, 5110]
        for (const [index, seconds] of expected.entries()) {
            await queue.runDue(start + seconds * 1000 - 1)
            expect(failure.mock.calls).toHaveLength(index)
            await Promise.all([queue.runDue(start + seconds * 1000), queue.runDue(start + seconds * 1000)])
            expect(failure.mock.calls).toHaveLength(index + 1)
        }
        await queue.runDue(start + 7_199_000)
        expect(failure).toHaveBeenCalledTimes(10)
        expect(success).toHaveBeenCalledTimes(1)
        expect(failure.mock.calls.every(([, notification]) => notification.id === id)).toBe(true)
        expect(store.hamlet.dueNotifications(start + 7_200_000)).toEqual([])
        expect(log).toHaveBeenCalledTimes(10)
    } finally {
        log.mockRestore()
        store.close()
    }
})

it('delivers another channel while the first is still pending', async () => {
    const store = new Store(':memory:')
    try {
        const session = main(store)
        let resolve!: (accepted: boolean) => void
        const blocked = mock<AgentNotificationSender>(() => new Promise(done => { resolve = done }))
        const success = mock<AgentNotificationSender>(async () => true)
        const queue = new AgentNotificationQueue(store.hamlet, engine(session), new Map([
            ['browser', blocked], ['simulated', success]
        ]))
        store.hamlet.enqueueNotification(session.id, 'notice', 'Review is ready', ['browser', 'simulated'], start)
        const pending = queue.runDue(start)
        await queue.runDue(start + 10_000)
        expect(blocked).toHaveBeenCalledTimes(1)
        expect(success).toHaveBeenCalledTimes(1)
        resolve(true)
        await pending
        expect(store.hamlet.dueNotifications(start + 10_000)).toEqual([])
    } finally {
        store.close()
    }
})

it('upgrades v29 and restores pending retry counts and the absolute deadline after a Hub restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hamlet-agent-notifications-'))
    const path = join(dir, 'hub.db')
    const log = spyOn(console, 'warn').mockImplementation(() => {})
    try {
        const original = new Store(path)
        const session = main(original)
        original.close()
        const old = new Database(path)
        old.exec('DROP TABLE hamlet_notification_deliveries; DROP TABLE hamlet_notifications; PRAGMA user_version=29')
        old.close()

        const migrated = new Store(path)
        const send = mock<AgentNotificationSender>(async () => false)
        const channels = new Map([['browser', send]])
        const first = new AgentNotificationQueue(migrated.hamlet, engine(session), channels)
        const id = migrated.hamlet.enqueueNotification(session.id, 'notice', 'Review is ready', ['browser'], start)
        await first.runDue(start)
        // Simulate loss after the next attempt was claimed, before it could record an outcome.
        const [claimed] = migrated.hamlet.dueNotifications(start + 10_000)
        expect(claimed.attempts).toBe(1)
        expect(migrated.hamlet.claimNotification(claimed, start + 10_000, start + 30_000)).toBe(true)
        migrated.close()

        const restarted = new Store(path)
        try {
            const next = new AgentNotificationQueue(restarted.hamlet, engine(session), channels)
            await next.runDue(start + 29_999)
            expect(send).toHaveBeenCalledTimes(1)
            expect(restarted.hamlet.dueNotifications(start + 30_000)[0].attempts).toBe(2)
            await next.runDue(start + 30_000)
            expect(send).toHaveBeenCalledTimes(2)
            expect(send.mock.calls[1][1].id).toBe(id)
            // The missed retries do not get caught up after the original deadline.
            await next.runDue(start + 7_200_000)
            expect(send).toHaveBeenCalledTimes(2)
            expect(restarted.hamlet.dueNotifications(start + 7_201_000)).toEqual([])
            expect(restarted.hamlet.enqueueNotification(session.id, 'notice', 'Review is ready', ['browser'], start + 8_000_000)).toBe(id)
            expect(restarted.hamlet.dueNotifications(start + 8_000_000)).toEqual([])
        } finally {
            restarted.close()
        }
    } finally {
        log.mockRestore()
        rmSync(dir, { recursive: true, force: true })
    }
})
