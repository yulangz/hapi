import { createECDH, createHash, randomBytes } from 'node:crypto'
import { generateVAPIDKeys } from 'web-push'
import { Store } from '../store'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { describe, expect, it, mock, spyOn } from 'bun:test'
import type { Session, SyncEvent } from '../sync/syncEngine'
import { PushNotificationChannel } from './pushNotificationChannel'
import { PushService, type PushDispatchResult, type PushPayload } from './pushService'

const main = { id: 'main-id', namespace: 'default', hamletMain: true, active: true,
    metadata: { path: '/work', host: 'host', name: 'Renamed assistant' } } as Session
const child = { ...main, id: 'child-id', hamletMain: undefined }
const notification = { id: 'stored-message-1', text: 'New reply' }

function setup({ delivered = false, acceptedEndpoints = [] as string[], uncertain = false } = {}) {
    const push = mock(async (_namespace: string, _payload: PushPayload): Promise<PushDispatchResult> => ({
        acceptedEndpoints, uncertain
    }))
    const toast = mock(async (_namespace: string, _event: Extract<SyncEvent, { type: 'toast' }>, _options: { includeHidden: boolean }) => delivered)
    const channel = new PushNotificationChannel(
        { sendToNamespace: push } as never, { sendToast: toast } as never
    )
    return { channel, push, toast }
}

describe('PushNotificationChannel', () => {
    it('sends the same agent notification to hidden global streams and Web Push', async () => {
        const { channel, push, toast } = setup()
        await channel.sendAgentNotification(main, notification)
        expect(toast).toHaveBeenCalledWith(main.namespace, expect.objectContaining({
            data: expect.objectContaining({
                notificationKind: 'main-agent-reply', notificationId: notification.id, notificationAt: expect.any(Number),
                body: notification.text, sessionId: main.id, url: '/sessions/main-id', pushAccepted: []
            })
        }), { includeHidden: true })
        expect(push).toHaveBeenCalledWith(main.namespace, expect.objectContaining({
            tag: 'hamlet-main-agent-' + notification.id,
            title: 'Hamlet', body: 'New notification from your main Agent',
            data: { type: 'main-agent-reply' }
        }))
        await channel.sendAgentNotification(main, { ...notification, id: 'stored-message-2' })
        expect(push.mock.calls[1][1].tag).not.toBe(push.mock.calls[0][1].tag)
    })

    it('reaches a closed browser endpoint even while another browser has visible SSE', async () => {
        const tracker = new VisibilityTracker()
        const sse = new SSEManager(0, tracker)
        const received: SyncEvent[] = []
        const store = new Store(':memory:')
        try {
            sse.subscribe({
                id: 'visible-browser',
                namespace: main.namespace,
                all: true,
                visibility: 'visible',
                send: event => { received.push(event) },
                sendHeartbeat: () => {}
            })
            const endpoints = ['https://push.example.test/closed-browser', 'https://push.example.test/visible-browser']
            for (const endpoint of endpoints) {
                store.push.addPushSubscription(main.namespace, { endpoint, p256dh: 'client-key', auth: 'client-auth' })
            }
            const push = new PushService(generateVAPIDKeys(), 'mailto:notifications@example.test', store)
            const send = spyOn(push as unknown as {
                sendToSubscription(namespace: string, subscription: { endpoint: string }, body: string): Promise<'accepted' | 'rejected'>
            }, 'sendToSubscription').mockImplementation(async (_namespace, subscription) =>
                subscription.endpoint === endpoints[0] ? 'accepted' : 'rejected'
            )
            expect(tracker.hasVisibleConnection(main.namespace)).toBe(true)
            expect(await new PushNotificationChannel(push, sse).sendAgentNotification(main, notification)).toBe('dispatched')

            expect(received).toHaveLength(1)
            expect(received[0]).toMatchObject({ type: 'toast', data: {
                body: notification.text,
                notificationId: notification.id,
                pushAccepted: [createHash('sha256').update(`${notification.id}\0${endpoints[0]}`).digest('hex')]
            } })
            expect(JSON.stringify(received[0])).not.toContain(endpoints[0])
            expect(send.mock.calls.map(([, subscription]) => subscription.endpoint).sort()).toEqual(endpoints)
            for (const [namespace, , body] of send.mock.calls) {
                expect(namespace).toBe(main.namespace)
                expect(JSON.parse(body)).toEqual({
                    title: 'Hamlet', body: 'New notification from your main Agent', tag: 'hamlet-main-agent-' + notification.id,
                    data: { type: 'main-agent-reply' }
                })
            }
        } finally {
            store.close()
        }
    })

    it('publishes fallback after the send settles, including when dispatch fails', async () => {
        const { channel, push, toast } = setup()
        const log = spyOn(console, 'error').mockImplementation(() => {})
        let rejectPush!: (error: Error) => void
        push.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPush = reject }))
        try {
            const pending = channel.sendAgentNotification(main, notification)
            expect(push).toHaveBeenCalledTimes(1)
            expect(toast).not.toHaveBeenCalled()
            rejectPush(new Error('Push unavailable'))
            expect(await pending).toBe('unknown')
            expect(toast.mock.calls[0][1].data.pushAccepted).toEqual([])
        } finally {
            log.mockRestore()
        }
    })

    it('reports a transport failure without logging subscription details', async () => {
        const store = new Store(':memory:')
        const endpoint = 'https://push.example.test/private-capability'
        const p256dh = createECDH('prime256v1').generateKeys().toString('base64url')
        const auth = randomBytes(16).toString('base64url')
        const error = Object.assign(new Error(endpoint), { code: 'ConnectionRefused', path: endpoint })
        const send = spyOn(globalThis, 'fetch').mockRejectedValueOnce(error)
        const log = spyOn(console, 'error').mockImplementation(() => {})
        try {
            store.push.addPushSubscription(main.namespace, { endpoint, p256dh, auth })
            const service = new PushService(generateVAPIDKeys(), 'mailto:notifications@example.test', store)
            expect(await service.sendToNamespace(main.namespace, { title: 'Hamlet', body: 'New notification from your main Agent' }))
                .toEqual({ acceptedEndpoints: [], uncertain: false })
            expect(log.mock.calls).toEqual([['[PushService] Failed to send notification:', 'ConnectionRefused']])
        } finally {
            send.mockRestore()
            log.mockRestore()
            store.close()
        }
    })

    it('can send foreground Web Push without waiting for the SSE toast', async () => {
        const { channel, push, toast } = setup({ acceptedEndpoints: ['https://push.example.test/accepted'] })
        let release!: (written: boolean) => void
        toast.mockImplementation(() => new Promise(resolve => { release = resolve }))
        try {
            await channel.sendAgentNotification(main, notification)
            expect(push).toHaveBeenCalledTimes(1)
        } finally {
            release(true)
        }
    })

    it('does not send an agent notification for a child, and keeps status and permission toasts in-app', async () => {
        const { channel, push, toast } = setup({ delivered: true })
        await channel.sendAgentNotification(child, notification)
        expect(toast).not.toHaveBeenCalled()
        await channel.sendReady(child)
        await channel.sendPermissionRequest(main)
        await channel.sendTaskNotification(main, { summary: 'Tool finished' })
        expect(toast).toHaveBeenCalledTimes(3)
        for (const [, event, options] of toast.mock.calls) {
            expect(event.data.notificationKind).toBeUndefined()
            expect(event.data.notificationId).toBeUndefined()
            expect(options).toEqual({ includeHidden: false })
        }
        expect(push).not.toHaveBeenCalled()
    })

    it.each([
        { delivered: false, uncertain: false, result: 'retryable' },
        { delivered: false, uncertain: true, result: 'unknown' },
        { delivered: true, uncertain: true, result: 'dispatched' },
    ])('uses SSE and unacknowledged Push outcomes to return $result', async ({ delivered, uncertain, result }) => {
        const { channel } = setup({ delivered, uncertain })
        expect(await channel.sendAgentNotification(main, notification)).toBe(result)
    })

    it('retains in-page toast deduplication when the native companion delivered', async () => {
        const { channel, push, toast } = setup()
        const ctx = { nativeGate: { sent: true } }
        await channel.sendReady(main, ctx)
        await channel.sendPermissionRequest(main, ctx)
        await channel.sendTaskNotification(main, { summary: 'Tool finished' }, ctx)
        expect(toast).not.toHaveBeenCalled()
        expect(push).not.toHaveBeenCalled()
    })
})
