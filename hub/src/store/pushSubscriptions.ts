import type { Database } from 'bun:sqlite'

import type { StoredPushSubscription } from './types'

type DbPushSubscriptionRow = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    created_at: number
}

function toStoredPushSubscription(row: DbPushSubscriptionRow): StoredPushSubscription {
    return {
        id: row.id,
        namespace: row.namespace,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        createdAt: row.created_at
    }
}

export function addPushSubscription(
    db: Database,
    namespace: string,
    subscription: { endpoint: string; p256dh: string; auth: string }
): void {
    db.transaction(() => {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND namespace <> ?')
            .run(subscription.endpoint, namespace)
        db.prepare(`
            INSERT INTO push_subscriptions (
                namespace, endpoint, p256dh, auth, created_at
            ) VALUES (
                @namespace, @endpoint, @p256dh, @auth, @created_at
            )
            ON CONFLICT(namespace, endpoint)
            DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                created_at = excluded.created_at
        `).run({
            namespace,
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh,
            auth: subscription.auth,
            created_at: Date.now()
        })
    })()
}

export function removePushSubscription(db: Database, namespace: string, endpoint: string): void {
    db.prepare(
        'DELETE FROM push_subscriptions WHERE namespace = ? AND endpoint = ?'
    ).run(namespace, endpoint)
}

// A legacy endpoint claimed by multiple accounts cannot be safely attributed.
const ownedSubscriptions = `
    FROM push_subscriptions AS subscription
    WHERE subscription.namespace = ?
      AND NOT EXISTS (
          SELECT 1 FROM push_subscriptions AS other
          WHERE other.endpoint = subscription.endpoint AND other.namespace <> subscription.namespace
      )
`

export function hasPushSubscription(db: Database, namespace: string, endpoint: string): boolean {
    return db.prepare(`SELECT 1 ${ownedSubscriptions} AND subscription.endpoint = ?`)
        .get(namespace, endpoint) !== null
}

export function getPushSubscriptionsByNamespace(
    db: Database,
    namespace: string
): StoredPushSubscription[] {
    const rows = db.prepare(
        `SELECT subscription.* ${ownedSubscriptions} ORDER BY subscription.created_at DESC`
    ).all(namespace) as DbPushSubscriptionRow[]
    return rows.map(toStoredPushSubscription)
}
