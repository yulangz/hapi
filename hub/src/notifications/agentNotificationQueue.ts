import type { HamletStore, NotificationDelivery } from '../hamlet/store'
import type { SyncEngine } from '../sync/syncEngine'
import type { AgentNotificationSender } from './notificationTypes'

const RETRY_BASE_MS = 10_000
const MAX_ATTEMPTS = 10
const MAX_AGE_MS = 2 * 60 * 60 * 1000
const POLL_MS = 1_000

export class AgentNotificationQueue {
    private readonly active = new Map<string, Promise<void>>()
    private timer?: ReturnType<typeof setInterval>

    constructor(
        private readonly store: HamletStore,
        private readonly engine: Pick<SyncEngine, 'getSessionByNamespace'>,
        private readonly channels: ReadonlyMap<string, AgentNotificationSender>,
    ) {}

    enqueue(agent: string, requestId: string, text: string): string {
        return this.store.enqueueNotification(agent, requestId, text, [...this.channels.keys()])
    }

    start(): void {
        const tick = () => {
            void this.runDue().catch(() => console.error('[AgentNotifications] Could not process the notification queue'))
        }
        this.timer = setInterval(tick, POLL_MS)
        this.timer.unref()
        tick()
    }

    async stop(): Promise<void> {
        clearInterval(this.timer)
        await Promise.allSettled(this.active.values())
    }

    async runDue(now = Date.now()): Promise<void> {
        const work: Promise<void>[] = []
        for (const delivery of this.store.dueNotifications(now)) {
            const key = `${delivery.notification_id}:${delivery.channel}`
            if (this.active.has(key)) continue
            const deadline = delivery.created_at + MAX_AGE_MS
            if (now >= deadline || delivery.attempts >= MAX_ATTEMPTS) {
                this.store.finishNotification(delivery, delivery.attempts)
                const reason = now >= deadline ? 'Deadline expired' : 'Attempt limit reached'
                console.warn('[AgentNotifications] Delivery stopped', delivery.notification_id, delivery.channel, reason)
                continue
            }
            // Persist the attempt and next eligible time before any network I/O.
            // A Hub restart can spend an attempt, but cannot reset the budget.
            const nextAttempt = Math.min(now + RETRY_BASE_MS * 2 ** delivery.attempts, deadline)
            if (!this.store.claimNotification(delivery, now, nextAttempt)) continue
            const attempt = this.deliver(delivery).finally(() => this.active.delete(key))
            this.active.set(key, attempt)
            work.push(attempt)
        }
        await Promise.all(work)
    }

    private async deliver(delivery: NotificationDelivery): Promise<void> {
        const { notification_id: id, channel, agent, namespace, text } = delivery
        const attempts = delivery.attempts + 1
        const send = this.channels.get(channel)
        const session = this.engine.getSessionByNamespace(agent, namespace)
        let failure = 'No route accepted delivery'
        try {
            if (send && session?.hamletMain) {
                if (await send(session, { id, text })) {
                    this.store.finishNotification(delivery, attempts)
                    return
                }
            } else {
                failure = send ? 'Main Agent session unavailable' : 'Channel unavailable'
            }
        } catch {
            failure = 'Channel or queue update failed'
        }
        console.warn('[AgentNotifications] Delivery failed', id, channel, attempts, failure)
        if (attempts === MAX_ATTEMPTS) this.store.finishNotification(delivery, attempts)
    }
}
