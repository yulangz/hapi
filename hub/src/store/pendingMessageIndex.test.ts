import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

describe('pending local message lookup index', () => {
    it('backfills an existing database and avoids a transcript scan without changing queue semantics', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hapi-pending-index-'))
        const path = join(directory, 'test.db')
        let store: Store | undefined
        let db: Database | undefined
        try {
            store = new Store(path)
            const session = store.sessions.getOrCreateSession('test', { path: '/tmp', host: 'test' }, null, 'default')
            store.messages.addMessage(session.id, { role: 'agent', content: 'history' })
            const pending = store.messages.addMessage(session.id, { role: 'user', content: 'now' }, 'pending')
            const scheduled = store.messages.addMessage(session.id, { role: 'user', content: 'later' }, 'scheduled', Date.now() + 60_000)
            store.close(); store = undefined
            db = new Database(path)
            const version = db.query('PRAGMA user_version').get()
            db.exec('DROP INDEX idx_messages_uninvoked_local')
            db.close(); db = undefined

            store = new Store(path)
            expect(store.messages.getUninvokedLocalMessages(session.id).map(row => row.id)).toEqual([pending.id, scheduled.id])
            db = new Database(path)
            const plan = db.query(`EXPLAIN QUERY PLAN SELECT * FROM messages
                WHERE session_id = ? AND invoked_at IS NULL AND local_id IS NOT NULL ORDER BY seq ASC`).all(session.id)
            expect(JSON.stringify(plan)).toContain('USING INDEX idx_messages_uninvoked_local')
            expect(db.query('PRAGMA user_version').get()).toEqual(version)
            expect(db.query('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 3 })
        } finally {
            db?.close()
            store?.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
