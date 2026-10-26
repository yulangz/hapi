import type { SyncEvent } from '@/types/api'

type NotificationEvent = Extract<SyncEvent, { type: 'toast' }>['data']

const STORAGE_KEY = 'hapi.localNotifications.v1'
const LOCK_NAME = 'hapi.localNotifications'
const MAX_AGE_MS = 60_000
const MAX_ENTRIES = 128

type Receipt = { id: string; at: number }

/** Live SSE fallback only. Remote Push remains responsible when the page is closed. */
export async function showLocalNotification(
    event: NotificationEvent,
    localized: { title: string; body: string },
    baseUrl: string
): Promise<boolean> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted'
        || !('serviceWorker' in navigator) || !navigator.locks
        || !event.notificationId || !Number.isFinite(event.notificationAt)) {
        return false
    }
    const id = event.notificationId
    const at = event.notificationAt as number

    try {
        // Serialize across all tabs, including hidden ones. Receipts survive tab
        // closure so a second recipient cannot repeat a dismissed notification.
        return await navigator.locks.request(LOCK_NAME, async () => {
            const now = Date.now()
            if (now - at > MAX_AGE_MS || at - now > MAX_AGE_MS
                || Notification.permission !== 'granted') return false

            const registration = await navigator.serviceWorker.getRegistration()
            if (!registration?.active || !registration.showNotification) return false
            // Check at delivery time, not a cached React state. When registration
            // recovers, remote Push takes over without duplicate local alerts.
            if (registration.pushManager && await registration.pushManager.getSubscription()) return false

            const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
            const receipts: Receipt[] = Array.isArray(raw) ? raw.filter(
                (value): value is Receipt => value !== null && typeof value === 'object'
                    && typeof value.id === 'string' && typeof value.at === 'number'
                    && now - value.at < MAX_AGE_MS && value.at <= now
            ) : []
            if (receipts.some(receipt => receipt.id === id)) return false

            const hubUrl = new URL(baseUrl || window.location.origin, window.location.origin)
            const url = new URL(event.url, hubUrl)
            if (!['http:', 'https:'].includes(url.protocol) || url.origin !== hubUrl.origin) return false

            // Fail closed if shared storage is unavailable; without a receipt,
            // simultaneous tabs could each show a banner for the same event.
            localStorage.setItem(STORAGE_KEY, JSON.stringify(
                [...receipts, { id, at: now }].slice(-MAX_ENTRIES)
            ))
            try {
                await registration.showNotification(localized.title, {
                    body: localized.body,
                    icon: '/pwa-192x192.png',
                    badge: '/pwa-64x64.png',
                    tag: `hapi-local-${id}`,
                    data: { type: 'local-fallback', sessionId: event.sessionId, url: url.toString() }
                })
            } catch (error) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(receipts))
                throw error
            }
            return true
        })
    } catch (error) {
        console.warn('[LocalNotifications] Could not display notification:', error)
        return false
    }
}
