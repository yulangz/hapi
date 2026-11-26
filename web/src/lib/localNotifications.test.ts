import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showLocalNotification } from './localNotifications'
import { showAgentNotificationOnce } from './agentNotificationReceipts'

vi.mock('./agentNotificationReceipts', async (importOriginal) => ({
    ...await importOriginal<typeof import('./agentNotificationReceipts')>(),
    showAgentNotificationOnce: vi.fn()
}))

const hub = 'https://hub.example.test'
const text = { title: '等待输入', body: 'Codex is ready' }
const notification = (id = 'dispatch-1') => ({
    title: 'Ready for input', body: 'Codex is ready', sessionId: 'session-1',
    url: '/sessions/session-1', notificationKind: 'main-agent-notification' as const, notificationId: id, notificationAt: Date.now()
})

describe('local system notification fallback', () => {
    const showNotification = vi.fn()
    const getSubscription = vi.fn()
    const getRegistration = vi.fn()
    const pageNotification = vi.fn()
    const isCurrentScope = vi.fn()
    let permission: NotificationPermission

    beforeEach(() => {
        permission = 'granted'
        isCurrentScope.mockReset().mockReturnValue(true)
        vi.stubGlobal('crypto', webcrypto)
        showNotification.mockReset().mockResolvedValue(undefined)
        getSubscription.mockReset().mockResolvedValue(null)
        getRegistration.mockReset().mockResolvedValue({
            active: {}, showNotification, pushManager: { getSubscription }
        })
        vi.mocked(showAgentNotificationOnce).mockReset().mockImplementation(async (_id, canShow, show) => {
            if (!canShow()) return false
            await show()
            return true
        })
        pageNotification.mockReset()
        vi.stubGlobal('navigator', { serviceWorker: { getRegistration } })
        vi.stubGlobal('Notification', class {
            static get permission() { return permission }
            onshow: (() => void) | undefined

            constructor(title: string, options: NotificationOptions) {
                pageNotification(title, options)
                queueMicrotask(() => this.onshow?.())
            }
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('uses the reply ID for receipts and honors a receipt from another recipient', async () => {
        const event = notification()
        expect(await showLocalNotification(event, text, hub, isCurrentScope)).toBe(true)
        expect(showAgentNotificationOnce).toHaveBeenCalledWith(event.notificationId, expect.any(Function), expect.any(Function))
        vi.mocked(showAgentNotificationOnce).mockResolvedValueOnce(false)
        expect(await showLocalNotification(event, text, hub, isCurrentScope)).toBe(false)
        expect(showNotification).toHaveBeenCalledTimes(1)
        expect(showNotification).toHaveBeenCalledWith(text.title, expect.objectContaining({
            body: text.body,
            data: { type: 'local-fallback', sessionId: 'session-1', url: `${hub}/sessions/session-1` }
        }))
    })

    it('does not merge separate completions with identical text', async () => {
        expect(await showLocalNotification(notification('one'), text, hub, isCurrentScope)).toBe(true)
        expect(await showLocalNotification(notification('two'), text, hub, isCurrentScope)).toBe(true)
        expect(showNotification).toHaveBeenCalledTimes(2)
    })

    it.each(['default', 'denied'] as const)('respects %s permission without prompting', async value => {
        permission = value
        expect(await showLocalNotification(notification(), text, hub, isCurrentScope)).toBe(false)
        expect(getSubscription).not.toHaveBeenCalled()
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('stops the fallback only for the exact reply and browser endpoint', async () => {
        const endpoint = 'https://push.example.test/channel'
        const event = notification('first')
        const pushAccepted = [createHash('sha256').update(`${event.notificationId}\0${endpoint}`).digest('hex')]
        getSubscription.mockResolvedValue({ endpoint })
        expect(await showLocalNotification(event, text, hub, isCurrentScope)).toBe(true)

        expect(await showLocalNotification({ ...event, pushAccepted }, text, hub, isCurrentScope)).toBe(false)
        expect(await showLocalNotification({ ...notification('second'), pushAccepted }, text, hub, isCurrentScope)).toBe(true)
        getSubscription.mockResolvedValue({ endpoint: 'https://push.example.test/other' })
        expect(await showLocalNotification({ ...event, pushAccepted }, text, hub, isCurrentScope)).toBe(true)
        expect(showNotification).toHaveBeenCalledTimes(3)
    })

    it('rejects a queued notification after the active scope changes', async () => {
        isCurrentScope.mockReturnValueOnce(true).mockReturnValue(false)
        expect(await showLocalNotification(notification(), text, hub, isCurrentScope)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('ignores legacy browser alerts and tool toasts', async () => {
        expect(await showLocalNotification({ ...notification(), notificationKind: undefined }, text, hub, isCurrentScope)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('ignores stale or uncorrelated events instead of replaying old notifications', async () => {
        expect(await showLocalNotification({ ...notification(), notificationAt: Date.now() - 61_000 }, text, hub, isCurrentScope)).toBe(false)
        expect(await showLocalNotification({ ...notification(), notificationId: undefined }, text, hub, isCurrentScope)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it.each(['javascript:alert(1)', 'https://other.example.test/'])('rejects unsafe session link %s', async url => {
        expect(await showLocalNotification({ ...notification(), url }, text, hub, isCurrentScope)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('displays a page notification when there is no active service worker', async () => {
        getRegistration.mockResolvedValue(undefined)
        expect(await showLocalNotification(notification(), text, hub, isCurrentScope)).toBe(true)
        expect(pageNotification).toHaveBeenCalledWith(text.title, expect.objectContaining({ body: text.body }))
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('allows another recipient to retry a failed display', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        showNotification.mockRejectedValueOnce(new Error('Display failed'))
        const event = notification()
        expect(await showLocalNotification(event, text, hub, isCurrentScope)).toBe(false)
        expect(await showLocalNotification(event, text, hub, isCurrentScope)).toBe(true)
    })
})
