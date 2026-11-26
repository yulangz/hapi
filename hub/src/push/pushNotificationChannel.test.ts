import { describe, expect, it, mock } from 'bun:test'
import type { Session, SyncEvent } from '../sync/syncEngine'
import { PushNotificationChannel } from './pushNotificationChannel'
import type { PushPayload } from './pushService'

const main = { id: 'main-id', namespace: 'default', hamletMain: true, active: true,
    metadata: { path: '/work', host: 'host', name: 'Renamed assistant' } } as Session
const child = { ...main, id: 'child-id', hamletMain: undefined }
const reply = { id: 'stored-message-1', text: 'New reply' }

function setup({ visible = false, delivered = 0, foreground = false } = {}) {
    const push = mock(async (_namespace: string, _payload: PushPayload) => {})
    const toast = mock(async (_namespace: string, _event: Extract<SyncEvent, { type: 'toast' }>, _options: { includeHidden: boolean }) => delivered)
    const channel = new PushNotificationChannel(
        { sendToNamespace: push } as never, { sendToast: toast } as never,
        { hasVisibleConnection: () => visible } as never, '', foreground
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
            data: { type: 'main-agent-reply', sessionId: main.id, url: '/sessions/main-id' }
        }))
        await channel.sendMainAgentReply(main, { ...reply, id: 'stored-message-2' })
        expect(push.mock.calls[1][1].tag).not.toBe(push.mock.calls[0][1].tag)
    })

    it.each([
        [false, 1, false],
        [false, 0, true],
        [true, 1, true],
    ] as const)('respects foreground=%s and visible delivery count=%s (push=%s)', async (foreground, delivered, expectedPush) => {
        const { channel, push, toast } = setup({ visible: true, delivered, foreground })
        await channel.sendMainAgentReply(main, reply)
        expect(toast).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledTimes(expectedPush ? 1 : 0)
    })

    it('can send foreground Web Push without waiting for the SSE toast', async () => {
        const { channel, push, toast } = setup({ visible: true, foreground: true })
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
        const { channel, push, toast } = setup({ visible: true, delivered: 1, foreground: true })
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
        const { channel, push, toast } = setup({ visible: true, foreground: true })
        const ctx = { nativeGate: { sent: true } }
        await channel.sendReady(main, ctx)
        await channel.sendPermissionRequest(main, ctx)
        await channel.sendTaskNotification(main, { summary: 'Tool finished' }, ctx)
        expect(toast).not.toHaveBeenCalled()
        expect(push).not.toHaveBeenCalled()
    })
})
