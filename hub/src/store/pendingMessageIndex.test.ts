import { Database } from 'bun:sqlite'
import { describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'
import { countFutureScheduledLocalMessages, countFutureScheduledBySessionIds, minFutureScheduledAtBySessionIds } from './messages'

describe('pending local message lookup index', () => {
    it('keeps all scheduled-list statistics on the small pending index without relying on planner statistics', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hamlet-scheduled-index-'))
        const path = join(directory, 'test.db')
        const store = new Store(path)
        let db: Database | undefined
        try {
            const session = store.sessions.getOrCreateSession('test', { path: '/tmp', host: 'test' }, null, 'default')
            const now = Date.now()
            for (let i = 0; i < 100; i++) store.messages.addMessage(session.id, { role: 'agent', content: 'history' }, `history-${i}`)
            store.messages.addMessage(session.id, { role: 'user', content: 'later' }, 'future', now + 60_000)
            db = new Database(path)
            const prepare = spyOn(db, 'prepare')
            expect(countFutureScheduledLocalMessages(db, session.id, now)).toBe(1)
            expect(countFutureScheduledBySessionIds(db, [session.id], now).get(session.id)).toBe(1)
            expect(minFutureScheduledAtBySessionIds(db, [session.id], now).get(session.id)).toBe(now + 60_000)
            const queries = prepare.mock.calls.map(([sql]) => sql)
            prepare.mockRestore()
            expect(queries).toHaveLength(3)
            for (const sql of queries) {
                const plan = JSON.stringify(db.query(`EXPLAIN QUERY PLAN ${sql}`).all(session.id, now))
                expect(plan).toContain('idx_messages_scheduled_pending')
                expect(plan).not.toContain('idx_messages_local_id')
            }
        } finally {
            db?.close()
            store.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })
    it('backfills an existing database and avoids a transcript scan without changing queue semantics', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hamlet-pending-index-'))
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
