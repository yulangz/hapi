// Keep logins, unsent drafts and pending shares when the same Hub changes its brand.
function migrateKeys(storage: Storage) {
    for (const key of Object.keys(storage)) {
        if (!/^hapi(?:[_:.-]|$)/i.test(key)) continue
        const renamed = key.replace(/^hapi/i, 'hamlet')
        if (storage.getItem(renamed) === null) storage.setItem(renamed, storage.getItem(key)!)
        storage.removeItem(key)
    }
}

function openDatabase(name: string, store: string, keyPath: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function copyDrafts(suffix: string, store: string, keyPath: string) {
    const oldName = 'hapi-' + suffix
    const old = await openDatabase(oldName, store, keyPath)
    try {
        const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
            const read = old.transaction(store).objectStore(store).getAll()
            read.onsuccess = () => resolve(read.result)
            read.onerror = () => reject(read.error)
        })
        if (rows.length) {
            const next = await openDatabase('hamlet-' + suffix, store, keyPath)
            try {
                await new Promise<void>((resolve, reject) => {
                    const tx = next.transaction(store, 'readwrite')
                    const target = tx.objectStore(store)
                    for (const row of rows) {
                        const exists = target.count(row[keyPath] as IDBValidKey)
                        exists.onsuccess = () => { if (!exists.result) target.add(row) }
                    }
                    tx.oncomplete = () => resolve()
                    tx.onabort = () => reject(tx.error)
                })
            } finally { next.close() }
        }
    } finally { old.close() }
    indexedDB.deleteDatabase(oldName)
}

export async function migrateBrandStorage() {
    try {
        migrateKeys(localStorage)
        migrateKeys(sessionStorage)
        if (typeof indexedDB === 'undefined' || localStorage.getItem('hamlet.brandStorageMigrated')) return
        await Promise.all([copyDrafts('composer-drafts', 'attachments', 'sessionId'), copyDrafts('share-transfers', 'transfers', 'id')])
        localStorage.setItem('hamlet.brandStorageMigrated', '1')
    } catch (error) {
        console.warn('Hamlet could not migrate browser storage', error)
    }
}
