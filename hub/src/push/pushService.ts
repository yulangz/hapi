import * as webPush from 'web-push'
import type { Store } from '../store'
import type { VapidKeys } from '../config/vapidKeys'

const PUSH_TIMEOUT_MS = 3_000
const SAFE_TRANSPORT_ERRORS = new Set([
    'AbortError', 'TimeoutError', 'TypeError', 'ConnectionRefused', 'ECONNREFUSED'
])

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

export type PushDispatchResult = { acceptedEndpoints: string[]; uncertain: boolean }

type PushDelivery = 'accepted' | 'rejected' | 'unknown'

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

    async sendToNamespace(namespace: string, payload: PushPayload): Promise<PushDispatchResult> {
        const subscriptions = this.store.push.getPushSubscriptionsByNamespace(namespace)
        const body = JSON.stringify(payload)
        const deliveries = await Promise.all(subscriptions.map(subscription =>
            this.sendToSubscription(namespace, subscription, body)
        ))
        return {
            acceptedEndpoints: subscriptions.filter((_, index) => deliveries[index] === 'accepted')
                .map(subscription => subscription.endpoint),
            uncertain: deliveries.includes('unknown')
        }
    }

    private async sendToSubscription(
        namespace: string,
        subscription: StoredSubscription,
        body: string
    ): Promise<PushDelivery> {
        const pushSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        }

        let request: webPush.RequestDetails
        let endpoint: URL
        try {
            request = webPush.generateRequestDetails(pushSubscription, body)
            endpoint = new URL(request.endpoint)
        } catch {
            console.error('[PushService] Invalid push subscription')
            return 'rejected'
        }
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return 'rejected'

        let response: Response
        try {
            // Bound the wait for acceptance, including connection setup.
            response = await fetch(endpoint, {
                method: request.method,
                headers: request.headers,
                body: request.body ? new Uint8Array(request.body) : undefined,
                redirect: 'manual',
                signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
            })
        } catch (error) {
            // Fetch errors can carry the full subscription URL, including its capability path.
            const code = (error as { code?: unknown } | null)?.code
            const name = error instanceof Error ? error.name : 'Error'
            const reason = typeof code === 'string' && SAFE_TRANSPORT_ERRORS.has(code) ? code : name
            console.error('[PushService] Failed to send notification:', SAFE_TRANSPORT_ERRORS.has(reason) ? reason : 'Error')
            return code === 'ConnectionRefused' || code === 'ECONNREFUSED' ? 'rejected' : 'unknown'
        }
        void response.body?.cancel().catch(() => {})
        if (response.ok) return 'accepted'
        if (response.status === 410) {
            try {
                this.store.push.removePushSubscription(namespace, subscription.endpoint)
            } catch {
                console.error('[PushService] Could not remove expired subscription')
            }
        } else {
            console.error('[PushService] Push endpoint returned status:', response.status)
        }
        return 'rejected'
    }
}
