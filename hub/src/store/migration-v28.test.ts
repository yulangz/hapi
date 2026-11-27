import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

describe('Store V28->V29 migration: doorbell ring limits', () => {
    it('adds ring counters to doorbells created before the limit existed', () => {
        const directory = mkdtempSync(join(tmpdir(), 'hamlet-migration-v28-to-v29-'))
        const dbPath = join(directory, 'test.db')
        let store: Store | undefined
        try {
            store = new Store(dbPath)
            store.close()
            store = undefined

            const db = new Database(dbPath, { create: true, readwrite: true, strict: true })
            db.exec(`
                ALTER TABLE hamlet_doorbells DROP COLUMN rings;
                ALTER TABLE hamlet_doorbells DROP COLUMN max_rings;
                PRAGMA user_version = 28;
            `)
            db.close()

            store = new Store(dbPath)
            const internalDb = (store as unknown as { db: Database }).db
            const columns = (internalDb.prepare('PRAGMA table_info(hamlet_doorbells)').all() as Array<{ name: string }>).map((c) => c.name)
            const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }

            expect(columns).toContain('rings')
            expect(columns).toContain('max_rings')
            expect(version.user_version).toBe(31)
        } finally {
            store?.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
