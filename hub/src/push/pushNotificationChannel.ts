import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Session, SyncEvent } from '../sync/syncEngine'
import type { AgentNotification, AgentNotificationOutcome, NotificationChannel, TaskNotification } from '../notifications/notificationTypes'
import type { NotificationSendContext } from '../notifications/notificationSendContext'
import { getAgentName, getSessionName } from '../notifications/sessionInfo'
import type { SSEManager } from '../sse/sseManager'
import type { PushPayload, PushService } from './pushService'
import { composeInputRequestNotification, getFirstPendingRequest } from '../notifications/inputRequest'

type ToastData = Extract<SyncEvent, { type: 'toast' }>['data']
const TOAST_WRITE_TIMEOUT_MS = 3_000
const BROWSER_NOTIFICATION_KIND = 'main-agent-notification' as const

export class PushNotificationChannel implements NotificationChannel {
    constructor(
        private readonly pushService: PushService,
        private readonly sseManager: SSEManager
    ) {}

    /**
     * Debug observability: gated on `HAMLET_NOTIFY_DEBUG=1`. Lets the operator
     * see which branch each notification took so we can root-cause "still
     * getting PWA notifications" reports without committing permanent log
     * spam to the hub journal.
     */
    private logBranch(method: string, namespace: string, branch: string): void {
        if (process.env.HAMLET_NOTIFY_DEBUG !== '1') return
        console.log(`[Push.${method}] ns=${namespace} ${branch}`)
    }

    async sendPermissionRequest(session: Session, ctx?: NotificationSendContext): Promise<void> {
        if (!session.active) {
            return
        }

        const name = getSessionName(session)
        const pending = getFirstPendingRequest(session)
        const { requestId, request } = pending ?? {}
        const inputNotification = composeInputRequestNotification(session, pending)
        const toolName = request?.tool ? ` (${request.tool})` : ''

        const payload: PushPayload = {
            title: inputNotification?.title ?? 'Permission Request',
            body: inputNotification?.body ?? `${name}${toolName}`,
            tag: inputNotification?.tag ?? `permission-${session.id}`,
            data: {
                type: inputNotification?.type ?? 'permission-request',
                sessionId: session.id,
                url: this.buildSessionPath(session.id),
                requestId
            }
        }

        await this.deliverWebOrToast(session, payload, ctx, 'permission')
    }

    async sendReady(session: Session, ctx?: NotificationSendContext): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)

        const payload: PushPayload = {
            title: 'Ready for input',
            body: `${agentName} is waiting in ${name}`,
            tag: `ready-${session.id}`,
            data: {
                type: 'ready',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        await this.deliverWebOrToast(session, payload, ctx, 'ready')
    }

    async sendTaskNotification(session: Session, notification: TaskNotification, ctx?: NotificationSendContext): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)
        const normalizedStatus = notification.status?.trim().toLowerCase()
        const isFailure = normalizedStatus === 'failed'
            || normalizedStatus === 'error'
            || normalizedStatus === 'killed'
            || normalizedStatus === 'aborted'

        const payload: PushPayload = {
            title: isFailure ? 'Task failed' : 'Task completed',
            body: `${agentName} · ${name} · ${notification.summary}`,
            data: {
                type: 'task-notification',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        await this.deliverWebOrToast(session, payload, ctx, 'task')
    }

    async sendAgentNotification(session: Session, notification: AgentNotification): Promise<AgentNotificationOutcome> {
        if (!session.hamletMain) return 'retryable'
        const body = notification.text.replace(/\s+/gu, ' ')
        // Keep Push generic because a browser endpoint can outlive its login.
        this.logBranch('notify_user', session.namespace, 'web-push-fired')
        const push = await this.pushService.sendToNamespace(session.namespace, {
            title: 'Hamlet',
            body: 'New notification from your main Agent',
            tag: `hamlet-main-agent-${notification.id}`,
            data: { type: BROWSER_NOTIFICATION_KIND }
        }).catch(() => {
            console.error('[Push.notify_user] Failed to dispatch Web Push')
            return { acceptedEndpoints: [], uncertain: true }
        })

        const toast = this.publishToast(session.namespace, 'notify_user', {
            title: getSessionName(session),
            body: body.length > 180 ? body.slice(0, 179) + '…' : body,
            sessionId: session.id,
            url: this.buildSessionPath(session.id),
            notificationKind: BROWSER_NOTIFICATION_KIND,
            notificationId: notification.id,
            notificationAt: Date.now(),
            pushAccepted: push.acceptedEndpoints.map(endpoint => createHash('sha256')
                .update(`${notification.id}\0${endpoint}`).digest('hex'))
        }).catch(() => null)

        if (push.acceptedEndpoints.length > 0) return 'dispatched'
        const deadline = new AbortController()
        const written = await Promise.race([
            toast, delay(TOAST_WRITE_TIMEOUT_MS, null, { signal: deadline.signal, ref: false })
        ]).finally(() => deadline.abort())
        if (written) return 'dispatched'
        return written === null || push.uncertain ? 'unknown' : 'retryable'
    }

    private async deliverWebOrToast(
        session: Session,
        payload: PushPayload,
        ctx: NotificationSendContext | undefined,
        method: 'permission' | 'ready' | 'task'
    ): Promise<void> {
        if (ctx?.nativeGate?.sent) {
            this.logBranch(method, session.namespace, 'defer-to-native')
            return
        }
        void this.publishToast(session.namespace, method, {
            title: payload.title,
            body: payload.body,
            sessionId: session.id,
            url: payload.data?.url ?? this.buildSessionPath(session.id)
        }).catch(() => {})
    }

    private async publishToast(
        namespace: string,
        method: 'permission' | 'ready' | 'task' | 'notify_user',
        data: ToastData
    ): Promise<boolean> {
        try {
            const event = { type: 'toast' as const, namespace, data }
            const written = method === 'notify_user'
                ? await this.sseManager.sendNotificationToast(namespace, event)
                : (await this.sseManager.sendToast(namespace, event)) > 0
            this.logBranch(method, namespace, written ? 'sse-toast-delivered' : 'sse-toast-zero')
            return written
        } catch (error) {
            this.logBranch(method, namespace, 'sse-toast-failed')
            throw error
        }
    }

    private buildSessionPath(sessionId: string): string {
        return `/sessions/${sessionId}`
    }
}
