import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'

function isPushSupported(): boolean {
    return typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
    const base64 = (base64Url + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/')
    const raw = atob(base64)
    const output = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i)
    }
    return output
}

/**
 * VAPID public key that the currently stored push subscription was created
 * with. When the hub changes (or its keys rotate), existing browser
 * subscriptions become undeliverable (push services reject them with
 * VapidPkHashMismatch), so we compare and re-create them on the next load.
 */
const PUSH_VAPID_KEY_STORAGE = 'hamlet.push.vapidKey'

function readStoredVapidKey(): string | null {
    try {
        return localStorage.getItem(PUSH_VAPID_KEY_STORAGE)
    } catch {
        return null
    }
}

function writeStoredVapidKey(publicKey: string): void {
    try {
        localStorage.setItem(PUSH_VAPID_KEY_STORAGE, publicKey)
    } catch {
        // Ignore storage errors — the key check degrades to a re-subscribe.
    }
}

export function usePushNotifications(api: ApiClient | null, scope: string | null) {
    const [isSupported, setIsSupported] = useState(false)
    const [permission, setPermission] = useState<NotificationPermission>('default')
    const [registeredScope, setRegisteredScope] = useState<string | null>(null)
    const activeScope = useRef(scope)

    useLayoutEffect(() => {
        activeScope.current = scope
        setRegisteredScope(null)
        return () => { activeScope.current = null }
    }, [scope])

    useEffect(() => {
        const supported = isPushSupported()
        setIsSupported(supported)
        if (supported) setPermission(Notification.permission)
    }, [])

    const shouldShowLocalNotification = useCallback(async (endpoint: string | undefined): Promise<boolean> => {
        if (!api || !scope || activeScope.current !== scope) return false
        if (!endpoint) {
            setRegisteredScope(null)
            return true
        }

        // Another sign-in can claim the endpoint or the Hub can lose its row.
        const status = await api.getPushSubscriptionStatus({ endpoint }, AbortSignal.timeout(3000))
            .catch(() => null)
        if (activeScope.current !== scope) return false
        const registered = status?.registered === true
        setRegisteredScope(registered ? scope : null)
        return !registered
    }, [api, scope])

    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (!isPushSupported()) {
            return false
        }

        const result = await Notification.requestPermission()
        setPermission(result)
        if (result !== 'granted') {
            setRegisteredScope(null)
        }
        return result === 'granted'
    }, [])

    const subscribe = useCallback(async (): Promise<boolean> => {
        if (!api || !scope || activeScope.current !== scope || !isPushSupported()) {
            return false
        }

        if (Notification.permission !== 'granted') {
            setPermission(Notification.permission)
            return false
        }

        setRegisteredScope(null)
        let unregistered: PushSubscription | null = null
        try {
            const registration = await navigator.serviceWorker.ready
            const existing = await registration.pushManager.getSubscription()
            const { publicKey } = await api.getPushVapidPublicKey()
            const applicationServerKey = base64UrlToUint8Array(publicKey).buffer as ArrayBuffer
            if (activeScope.current !== scope) return false
            // A subscription created against a previous hub or VAPID key can
            // never receive notifications from the current hub. Detect the
            // mismatch via the key recorded at subscribe time and recreate it.
            let subscription = existing
            if (existing && readStoredVapidKey() !== publicKey) {
                const staleEndpoint = existing.endpoint
                const unsubscribed = await existing.unsubscribe()
                if (!unsubscribed) return false
                // Prune the obsolete endpoint from the hub so it stops
                // receiving failed sends (VapidPkHashMismatch) for a
                // subscription that can no longer be reached.
                if (staleEndpoint) {
                    try {
                        await api.unsubscribePushNotifications({ endpoint: staleEndpoint })
                    } catch {
                        // Best-effort cleanup — a stale hub registration is
                        // harmless beyond repeated failed sends until pruned.
                    }
                }
                subscription = null
            }
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                })
                unregistered = subscription
            }

            const json = subscription.toJSON()
            const keys = json.keys
            if (!json.endpoint || !keys?.p256dh || !keys.auth || activeScope.current !== scope) {
                await unregistered?.unsubscribe()
                return false
            }

            await api.subscribePushNotifications({
                endpoint: json.endpoint,
                keys: {
                    p256dh: keys.p256dh,
                    auth: keys.auth
                }
            })
            // Only record the key after the hub registration succeeded. A
            // failed registration must leave the previous key in place so the
            // next load retries the replacement instead of reusing a
            // subscription the hub never learned about.
            writeStoredVapidKey(publicKey)
            if (activeScope.current !== scope) return false
            setRegisteredScope(scope)
            return true
        } catch (error) {
            // A new endpoint that could not be registered can be recreated
            // on the next attempt.
            await unregistered?.unsubscribe().catch(() => {})
            console.error('[PushNotifications] Failed to subscribe:', error)
            return false
        }
    }, [api, scope])

    const unsubscribe = useCallback(async (): Promise<boolean> => {
        if (!api || !scope || activeScope.current !== scope || !isPushSupported()) {
            return false
        }

        try {
            const registration = await navigator.serviceWorker.ready
            const subscription = await registration.pushManager.getSubscription()
            if (!subscription) {
                setRegisteredScope(null)
                return true
            }

            const endpoint = subscription.endpoint
            const success = await subscription.unsubscribe()
            if (!success) return false
            await api.unsubscribePushNotifications({ endpoint })
            setRegisteredScope(null)
            return true
        } catch (error) {
            console.error('[PushNotifications] Failed to unsubscribe:', error)
            return false
        }
    }, [api, scope])

    return {
        isSupported,
        permission,
        isSubscribed: Boolean(scope && registeredScope === scope && permission === 'granted'),
        shouldShowLocalNotification,
        requestPermission,
        subscribe,
        unsubscribe
    }
}
