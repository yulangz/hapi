import * as webPush from 'web-push'
import type { Store } from '../store'
import type { VapidKeys } from '../config/vapidKeys'

const PUSH_TIMEOUT_MS = 3_000

export type PushPayload = {
    title: string
    body: string
    tag?: string
    data?: {
        type: string
        sessionId?: string
        url?: string
        /** First pending request id; input-request uses it for correlation, never approval. */
        requestId?: string
    }
}

type StoredSubscription = {
    endpoint: string
    p256dh: string
    auth: string
}

type PushSubscription = {
    endpoint: string
    keys: {
        p256dh: string
        auth: string
    }
}

export class PushService {
    constructor(
        private readonly vapidKeys: VapidKeys,
        private readonly subject: string,
        private readonly store: Store
    ) {
        webPush.setVapidDetails(this.subject, this.vapidKeys.publicKey, this.vapidKeys.privateKey)
    }

    async sendToNamespace(namespace: string, payload: PushPayload): Promise<string[]> {
        const subscriptions = this.store.push.getPushSubscriptionsByNamespace(namespace)
        const body = JSON.stringify(payload)
        const accepted = await Promise.all(subscriptions.map(subscription =>
            this.sendToSubscription(namespace, subscription, body)
        ))
        return accepted.filter(endpoint => endpoint !== null)
    }

    private async sendToSubscription(
        namespace: string,
        subscription: StoredSubscription,
        body: string
    ): Promise<string | null> {
        const pushSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        }

        try {
            const request = webPush.generateRequestDetails(pushSubscription, body)
            const endpoint = new URL(request.endpoint)
            if (endpoint.protocol !== 'https:') return null

            // Bound the wait for acceptance, including connection setup.
            const response = await fetch(endpoint, {
                method: request.method,
                headers: request.headers,
                body: request.body ? new Uint8Array(request.body) : undefined,
                redirect: 'manual',
                signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
            })
            void response.body?.cancel().catch(() => {})
            if (response.ok) return subscription.endpoint
            if (response.status === 410) {
                this.store.push.removePushSubscription(namespace, subscription.endpoint)
            } else {
                console.error('[PushService] Push endpoint returned status:', response.status)
            }
        } catch (error) {
            console.error('[PushService] Failed to send notification:', error)
        }
        return null
    }
}
