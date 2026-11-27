import { expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentConfig } from '@hamlet/protocol/hamlet'
import { Store } from './index'

it('upgrades published v30 receipts to v31 without recreating deliveries or changing chat history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hamlet-migrate-notifications-'))
    const path = join(directory, 'hamlet.db')
    let store: Store | undefined
    try {
        store = new Store(path)
        store.machines.getOrCreateMachine('machine', {}, null, 'scope')
        const config = AgentConfig.parse({
            machine_id: 'machine', directory: '/work', name: 'Main', description: 'Fixture', prompt: 'First task',
        })
        const main = store.hamlet.register('scope', null, 'main', config)
        const child = store.hamlet.register('scope', main.id, 'child', config)
        const session = store.sessions.getOrCreateSession('hamlet:' + main.id, {}, null, 'scope')
        const message = store.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: 'Keep this history' } })
        store.close()
        store = undefined

        const legacy = new Database(path)
        const statuses = ['dispatched', 'dispatching', 'failed'] as const
        const requests = statuses.map(status => ({
            id: randomUUID(), key: status, text: 'Old request ' + status,
        }))
        try {
            legacy.exec(`
                DROP TABLE hamlet_notification_deliveries;
                DROP TABLE hamlet_notifications;
                CREATE TABLE hamlet_notification_requests (
                    agent TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE,
                    request_id TEXT NOT NULL, id TEXT NOT NULL, text_hash TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('dispatching', 'dispatched', 'failed')),
                    PRIMARY KEY(agent,request_id)
                );
                PRAGMA user_version=30;
            `)
            const insert = legacy.prepare('INSERT INTO hamlet_notification_requests VALUES(?,?,?,?,?)')
            for (const { id, key, text } of requests) {
                insert.run(main.id, key, id, createHash('sha256').update(text).digest('hex'), key)
            }
        } finally {
            legacy.close()
        }

        store = new Store(path)
        expect(store.hamlet.agent(main.id)).toEqual(main)
        expect(store.hamlet.agent(child.id)).toEqual(child)
        expect(store.messages.getMessages(session.id)).toEqual([message])
        const migrated = new Database(path, { readonly: true })
        try {
            expect(migrated.query('PRAGMA user_version').get()).toEqual({ user_version: 31 })
            expect(migrated.query('SELECT count(*) AS count FROM hamlet_notification_requests').get()).toEqual({ count: 3 })
        } finally {
            migrated.close()
        }

        const now = Date.now()
        for (const { id, key, text } of requests) {
            expect(store.hamlet.enqueueNotification(main.id, key, text, ['browser'], now)).toBe(id)
        }
        expect(() => store!.hamlet.enqueueNotification(main.id, 'failed', 'Different text', ['browser'], now)).toThrow('different text')
        expect(store.hamlet.dueNotifications(now)).toEqual([])
        const id = store.hamlet.enqueueNotification(main.id, 'new-request', 'New text', ['browser'], now)
        expect(store.hamlet.dueNotifications(now)).toMatchObject([
            { notification_id: id, agent: main.id, namespace: 'scope', channel: 'browser', attempts: 0 },
        ])
    } finally {
        store?.close()
        rmSync(directory, { recursive: true, force: true })
    }
})
