import { generateVAPIDKeys } from 'web-push'
import { Store } from '../store'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { describe, expect, it, mock, spyOn } from 'bun:test'
import type { Session, SyncEvent } from '../sync/syncEngine'
import { PushNotificationChannel } from './pushNotificationChannel'
import { PushService, type PushPayload } from './pushService'

const main = { id: 'main-id', namespace: 'default', hamletMain: true, active: true,
    metadata: { path: '/work', host: 'host', name: 'Renamed assistant' } } as Session
const child = { ...main, id: 'child-id', hamletMain: undefined }
const reply = { id: 'stored-message-1', text: 'New reply' }

function setup({ delivered = 0 } = {}) {
    const push = mock(async (_namespace: string, _payload: PushPayload) => {})
    const toast = mock(async (_namespace: string, _event: Extract<SyncEvent, { type: 'toast' }>, _options: { includeHidden: boolean }) => delivered)
    const channel = new PushNotificationChannel(
        { sendToNamespace: push } as never, { sendToast: toast } as never
    )
    return { channel, push, toast }
}

describe('PushNotificationChannel', () => {
    it('sends the same main reply to hidden global streams and Web Push', async () => {
        const { channel, push, toast } = setup()
        await channel.sendMainAgentReply(main, reply)
        expect(toast).toHaveBeenCalledWith(main.namespace, expect.objectContaining({
            data: expect.objectContaining({
                notificationKind: 'main-agent-reply', notificationId: reply.id, notificationAt: expect.any(Number),
                body: reply.text, sessionId: main.id, url: '/sessions/main-id'
            })
        }), { includeHidden: true })
        expect(push).toHaveBeenCalledWith(main.namespace, expect.objectContaining({
            tag: 'hamlet-main-agent-' + reply.id,
            title: 'Hamlet', body: 'New main Agent reply',
            data: { type: 'main-agent-reply' }
        }))
        await channel.sendMainAgentReply(main, { ...reply, id: 'stored-message-2' })
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
                sendToSubscription(namespace: string, subscription: { endpoint: string }, body: string): Promise<void>
            }, 'sendToSubscription').mockResolvedValue(undefined)
            expect(tracker.hasVisibleConnection(main.namespace)).toBe(true)
            await new PushNotificationChannel(push, sse).sendMainAgentReply(main, reply)

            expect(received).toHaveLength(1)
            expect(received[0]).toMatchObject({ type: 'toast', data: { body: reply.text, notificationId: reply.id } })
            expect(send.mock.calls.map(([, subscription]) => subscription.endpoint).sort()).toEqual(endpoints)
            for (const [namespace, , body] of send.mock.calls) {
                expect(namespace).toBe(main.namespace)
                expect(JSON.parse(body)).toEqual({
                    title: 'Hamlet', body: 'New main Agent reply', tag: 'hamlet-main-agent-' + reply.id,
                    data: { type: 'main-agent-reply' }
                })
            }
        } finally {
            store.close()
        }
    })

    it('can send foreground Web Push without waiting for the SSE toast', async () => {
        const { channel, push, toast } = setup()
        let release!: (count: number) => void
        toast.mockImplementation(() => new Promise(resolve => { release = resolve }))
        try {
            await channel.sendMainAgentReply(main, reply)
            expect(push).toHaveBeenCalledTimes(1)
        } finally {
            release(1)
        }
    })

    it('does not send a child reply, and keeps status and permission toasts in-app', async () => {
        const { channel, push, toast } = setup({ delivered: 1 })
        await channel.sendMainAgentReply(child, reply)
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
