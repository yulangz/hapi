export const MAIN_AGENT_NOTIFICATION_TAG_PREFIX = 'hamlet-main-agent-'

const DB_NAME = 'hamlet.agentNotifications'
const STORE = 'receipts'
// Outlive web-push's default 28-day TTL, including a delayed acceptance.
const RECEIPT_LIFETIME_MS = 29 * 24 * 60 * 60 * 1000

export function hasNotificationPermission(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

function openReceipts(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE).createIndex('expiresAt', 'expiresAt')
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function changeReceipts(db: IDBDatabase, change: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new Error('Notification receipt transaction aborted'))
        change(transaction.objectStore(STORE))
    })
}

async function claimReceipt(db: IDBDatabase, id: string): Promise<boolean> {
    const now = Date.now()
    let claimed = false
    await changeReceipts(db, store => {
        const existing = store.get(id)
        existing.onsuccess = () => {
            if (existing.result?.expiresAt > now) return
            const expired = store.index('expiresAt').getAllKeys(IDBKeyRange.upperBound(now), 128)
            expired.onsuccess = () => {
                for (const key of expired.result) store.delete(key)
                store.put({ expiresAt: now + RECEIPT_LIFETIME_MS }, id)
                claimed = true
            }
        }
    })
    return claimed
}

/** Both the page and worker claim the server-assigned notification UUID before displaying. */
export async function showAgentNotificationOnce(
    id: string,
    canShow: () => boolean,
    show: () => void | Promise<void>
): Promise<boolean> {
    const deliver = async () => {
        if (!canShow()) return false
        let db: IDBDatabase | undefined
        let claimed = false
        let displayed = false
        try {
            try {
                db = await openReceipts()
                if (!canShow()) return false
                claimed = await claimReceipt(db, id)
                if (!claimed) return false
            } catch (error) {
                // Storage can be blocked or unavailable. Still attempt the alert.
                console.warn('[AgentNotifications] Could not claim notification receipt:', error)
            }
            if (!canShow()) return false
            await show()
            displayed = true
            return true
        } finally {
            if (db && claimed && !displayed) {
                await changeReceipts(db, store => { store.delete(id) }).catch(error => {
                    console.warn('[AgentNotifications] Could not release notification receipt:', error)
                })
            }
            db?.close()
        }
    }

    // With Web Locks a competing recipient waits for display or release. The
    // IndexedDB read-write transaction still arbitrates claims without locks.
    return navigator.locks ? navigator.locks.request(`${DB_NAME}:${id}`, deliver) : deliver()
}
