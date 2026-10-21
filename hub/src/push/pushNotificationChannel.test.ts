import { describe, expect, it } from 'bun:test'
import type { Session } from '../sync/syncEngine'
import { PushNotificationChannel } from './pushNotificationChannel'
import type { PushPayload } from './pushService'

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-task-toast',
        namespace: 'default',
        name: 'Demo task',
        active: true,
        metadata: { flavor: 'codex' },
        ...overrides
    } as Session
}

describe('PushNotificationChannel', () => {
    it('sends task notifications to visible web clients before falling back to push', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async (_namespace: string, event: unknown) => {
                    toasts.push(event)
                    return 1
                }
            } as never,
            {
                hasVisibleConnection: () => true
            } as never,
            ''
        )

        await channel.sendTaskNotification(createSession(), {
            status: 'completed',
            summary: 'Background work finished'
        })

        expect(toasts).toHaveLength(1)
        expect(pushed).toHaveLength(0)
    })

    it.each(['ready', 'permission', 'task'] as const)('sends foreground %s notifications through both toast and Web Push when enabled', async kind => {
        const pushed: PushPayload[] = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            { sendToNamespace: async (_namespace: string, payload: PushPayload) => { pushed.push(payload) } } as never,
            { sendToast: async (_namespace: string, event: unknown) => { toasts.push(event); return 1 } } as never,
            { hasVisibleConnection: () => true } as never,
            '', true
        )
        const session = createSession({ agentState: { requests: { 'req-1': { tool: 'Bash', arguments: {} } } } })
        if (kind === 'ready') await channel.sendReady(session)
        else if (kind === 'permission') await channel.sendPermissionRequest(session)
        else await channel.sendTaskNotification(session, { status: 'completed', summary: 'Done' })
        expect(toasts).toHaveLength(1)
        expect(pushed).toHaveLength(1)
        expect(pushed[0].data?.sessionId).toBe(session.id)
    })

    it('retains native-delivery deduplication even when foreground Web Push is enabled', async () => {
        const pushed: PushPayload[] = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            { sendToNamespace: async (_namespace: string, payload: PushPayload) => { pushed.push(payload) } } as never,
            { sendToast: async (_namespace: string, event: unknown) => { toasts.push(event); return 1 } } as never,
            { hasVisibleConnection: () => true } as never,
            '', true
        )
        await channel.sendReady(createSession(), { nativeGate: { sent: true } })
        expect(toasts).toHaveLength(0)
        expect(pushed).toHaveLength(0)
    })

    it.each(['ready', 'permission', 'task'] as const)('does not let a stalled toast block foreground %s Web Push', async kind => {
        const pushed: PushPayload[] = []
        let releaseToast!: (count: number) => void
        const toast = new Promise<number>(resolve => { releaseToast = resolve })
        const channel = new PushNotificationChannel(
            { sendToNamespace: async (_namespace: string, payload: PushPayload) => { pushed.push(payload) } } as never,
            { sendToast: () => toast } as never,
            { hasVisibleConnection: () => true } as never,
            '', true
        )
        const session = createSession()
        const delivery = kind === 'ready' ? channel.sendReady(session)
            : kind === 'permission' ? channel.sendPermissionRequest(session)
            : channel.sendTaskNotification(session, { status: 'completed', summary: 'Done' })
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            const completed = await Promise.race([
                delivery.then(() => true),
                new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 100) })
            ])
            expect(completed).toBe(true)
            expect(pushed).toHaveLength(1)
        } finally {
            clearTimeout(timer)
            releaseToast(1)
            await delivery
        }
    })

    it('still sends foreground Web Push if toast delivery rejects', async () => {
        const pushed: PushPayload[] = []
        const channel = new PushNotificationChannel(
            { sendToNamespace: async (_namespace: string, payload: PushPayload) => { pushed.push(payload) } } as never,
            { sendToast: async () => { throw new Error('Closed SSE stream') } } as never,
            { hasVisibleConnection: () => true } as never,
            '', true
        )
        await channel.sendReady(createSession())
        expect(pushed).toHaveLength(1)
    })

    it('falls back to Web Push when a visible connection cannot receive the toast', async () => {
        const pushed: PushPayload[] = []
        const channel = new PushNotificationChannel(
            { sendToNamespace: async (_namespace: string, payload: PushPayload) => { pushed.push(payload) } } as never,
            { sendToast: async () => 0 } as never,
            { hasVisibleConnection: () => true } as never,
            ''
        )
        await channel.sendReady(createSession())
        expect(pushed).toHaveLength(1)
    })

    it('does not reuse one replacement tag for all task notifications in a session', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        await channel.sendTaskNotification(createSession(), {
            status: 'completed',
            summary: 'First task'
        })
        await channel.sendTaskNotification(createSession(), {
            status: 'failed',
            summary: 'Second task'
        })

        expect(pushed).toHaveLength(2)
        expect(pushed[0].payload.tag).toBeUndefined()
        expect(pushed[1].payload.tag).toBeUndefined()
    })

    it('skips web-push when native FCM delivered in the same dispatch', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        const ctx = { nativeGate: { sent: true } }

        await channel.sendPermissionRequest(createSession({
            agentState: {
                requests: { 'req-1': { tool: 'Bash', arguments: {} } }
            }
        }), ctx)
        await channel.sendReady(createSession(), ctx)
        await channel.sendTaskNotification(createSession(), {
            status: 'completed',
            summary: 'Done'
        }, ctx)

        expect(pushed).toHaveLength(0)
    })

    it('falls back to web-push when native gate is unset (FCM failed or absent)', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        await channel.sendReady(createSession(), { nativeGate: { sent: false } })

        expect(pushed).toHaveLength(1)
    })

    it('still sends web-push when no native gate is provided', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async () => 0
            } as never,
            {
                hasVisibleConnection: () => false
            } as never,
            ''
        )

        await channel.sendReady(createSession())

        expect(pushed).toHaveLength(1)
    })

    it('also skips SSE in-page toast when native gate reports delivery', async () => {
        const pushed: Array<{ namespace: string; payload: PushPayload }> = []
        const toasts: unknown[] = []
        const channel = new PushNotificationChannel(
            {
                sendToNamespace: async (namespace: string, payload: PushPayload) => {
                    pushed.push({ namespace, payload })
                }
            } as never,
            {
                sendToast: async (_namespace: string, event: unknown) => {
                    toasts.push(event)
                    return 99
                }
            } as never,
            {
                hasVisibleConnection: () => true
            } as never,
            ''
        )

        const ctx = { nativeGate: { sent: true } }

        await channel.sendReady(createSession(), ctx)
        await channel.sendPermissionRequest(createSession({
            agentState: { requests: { 'r-1': { tool: 'Bash', arguments: {} } } }
        }), ctx)
        await channel.sendTaskNotification(createSession(), {
            status: 'completed',
            summary: 'Done'
        }, ctx)

        // Even when the PWA is foreground/visible, the operator asked to mute
        // it - the in-page React toast and the OS web-push are both dropped
        // when an FCM companion is on the wrist.
        expect(toasts).toHaveLength(0)
        expect(pushed).toHaveLength(0)
    })
})
