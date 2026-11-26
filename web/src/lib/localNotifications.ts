import type { SyncEvent } from '@/types/api'
import { hasNotificationPermission, MAIN_AGENT_NOTIFICATION_TAG_PREFIX, showAgentNotificationOnce } from './agentNotificationReceipts'

type NotificationEvent = Extract<SyncEvent, { type: 'toast' }>['data']

const MAX_AGE_MS = 60_000

/** Live SSE fallback only. Remote Push remains responsible when the page is closed. */
export async function showLocalNotification(
    event: NotificationEvent,
    localized: { title: string; body: string },
    baseUrl: string,
    isCurrentScope: () => boolean
): Promise<boolean> {
    if (event.notificationKind !== 'main-agent-notification' || !event.notificationId
        || !Number.isFinite(event.notificationAt)) {
        return false
    }
    const id = event.notificationId
    const at = event.notificationAt as number
    const canShow = () => hasNotificationPermission() && isCurrentScope() && Math.abs(Date.now() - at) <= MAX_AGE_MS
    if (!canShow()) return false

    try {
        const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
        if (event.pushAccepted?.length && crypto.subtle) {
            const subscription = await registration?.pushManager?.getSubscription().catch(() => null)
            if (subscription) {
                const input = new TextEncoder().encode(`${id}\0${subscription.endpoint}`)
                const digest = await crypto.subtle.digest('SHA-256', input)
                const receipt = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
                if (event.pushAccepted.includes(receipt)) return false
            }
        }

        const hubUrl = new URL(baseUrl || window.location.origin, window.location.origin)
        const url = new URL(event.url, hubUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== hubUrl.origin) return false

        const options = {
            body: localized.body,
            icon: '/pwa-192x192.png',
            badge: '/pwa-64x64.png',
            tag: MAIN_AGENT_NOTIFICATION_TAG_PREFIX + id,
            data: { type: 'local-fallback', sessionId: event.sessionId, url: url.toString() }
        }
        return await showAgentNotificationOnce(id, canShow, async () => {
            if (registration?.active && registration.showNotification) {
                await registration.showNotification(localized.title, options)
                return
            }
            await new Promise<void>((resolve, reject) => {
                const notification = new Notification(localized.title, options)
                notification.onshow = () => resolve()
                notification.onerror = () => reject(new Error('Browser could not show notification'))
                notification.onclick = () => {
                    if (isCurrentScope()) window.location.assign(url)
                    notification.close()
                }
            })
        })
    } catch (error) {
        console.warn('[LocalNotifications] Could not display notification:', error)
        return false
    }
}
