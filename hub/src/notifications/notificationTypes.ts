import type { Session } from '../sync/syncEngine'
import type { SessionEndReason } from '@hamlet/protocol'
import type { NotificationSendContext } from './notificationSendContext'

export type TaskNotification = {
    summary: string
    status?: string
}

export type AgentNotification = { id: string; text: string }
export type AgentNotificationOutcome = 'dispatched' | 'retryable' | 'unknown'
export type AgentNotificationSender = (session: Session, notification: AgentNotification) => Promise<AgentNotificationOutcome>

export type NotificationChannel = {
    sendReady: (session: Session, ctx?: NotificationSendContext) => Promise<void>
    sendPermissionRequest: (session: Session, ctx?: NotificationSendContext) => Promise<void>
    sendTaskNotification: (session: Session, notification: TaskNotification, ctx?: NotificationSendContext) => Promise<void>
    sendAgentNotification?: AgentNotificationSender
    sendSessionCompletion?: (session: Session, reason: SessionEndReason) => Promise<void>
}

export type NotificationHubOptions = {
    readyCooldownMs?: number
    permissionDebounceMs?: number
}
