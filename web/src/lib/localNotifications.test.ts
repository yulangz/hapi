import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showLocalNotification } from './localNotifications'

const hub = 'https://hub.example.test'
const text = { title: '等待输入', body: 'Codex is ready' }
const notification = (id = 'dispatch-1') => ({
    title: 'Ready for input', body: 'Codex is ready', sessionId: 'session-1',
    url: '/sessions/session-1', notificationId: id, notificationAt: Date.now()
})

describe('local system notification fallback', () => {
    const showNotification = vi.fn()
    const getSubscription = vi.fn()
    let permission: NotificationPermission

    beforeEach(() => {
        localStorage.clear()
        permission = 'granted'
        showNotification.mockReset().mockResolvedValue(undefined)
        getSubscription.mockReset().mockResolvedValue(null)
        let pending = Promise.resolve<unknown>(undefined)
        vi.stubGlobal('navigator', {
            serviceWorker: { getRegistration: vi.fn().mockResolvedValue({
                active: {}, showNotification, pushManager: { getSubscription }
            }) },
            // All recipients share one exclusive browser lock, as real tabs do.
            locks: { request: (_name: string, callback: () => Promise<unknown>) => {
                const result = pending.then(callback)
                pending = result.catch(() => undefined)
                return result
            } }
        })
        vi.stubGlobal('Notification', { get permission() { return permission } })
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('shows one localized system notification across simultaneous recipients, even after dismissal', async () => {
        const event = notification()
        expect(await Promise.all([
            showLocalNotification(event, text, hub),
            showLocalNotification(event, text, hub),
            showLocalNotification(event, text, hub)
        ])).toEqual([true, false, false])
        expect(await showLocalNotification(event, text, hub)).toBe(false)
        expect(showNotification).toHaveBeenCalledTimes(1)
        expect(showNotification).toHaveBeenCalledWith(text.title, expect.objectContaining({
            body: text.body,
            data: { type: 'local-fallback', sessionId: 'session-1', url: `${hub}/sessions/session-1` }
        }))
    })

    it('does not merge separate completions with identical text', async () => {
        expect(await showLocalNotification(notification('one'), text, hub)).toBe(true)
        expect(await showLocalNotification(notification('two'), text, hub)).toBe(true)
        expect(showNotification).toHaveBeenCalledTimes(2)
    })

    it.each(['default', 'denied'] as const)('respects %s permission without prompting', async value => {
        permission = value
        expect(await showLocalNotification(notification(), text, hub)).toBe(false)
        expect(getSubscription).not.toHaveBeenCalled()
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('stops the fallback as soon as a remote subscription exists', async () => {
        expect(await showLocalNotification(notification('before'), text, hub)).toBe(true)
        getSubscription.mockResolvedValue({ endpoint: 'https://push.example.test/channel' })
        expect(await showLocalNotification(notification('after'), text, hub)).toBe(false)
        expect(showNotification).toHaveBeenCalledTimes(1)
    })

    it('ignores stale or uncorrelated events instead of replaying old notifications', async () => {
        expect(await showLocalNotification({ ...notification(), notificationAt: Date.now() - 61_000 }, text, hub)).toBe(false)
        expect(await showLocalNotification({ ...notification(), notificationId: undefined }, text, hub)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it.each(['javascript:alert(1)', 'https://other.example.test/'])('rejects unsafe session link %s', async url => {
        expect(await showLocalNotification({ ...notification(), url }, text, hub)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('fails closed when cross-tab receipts cannot be persisted', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(await showLocalNotification(notification(), text, hub)).toBe(false)
        expect(showNotification).not.toHaveBeenCalled()
    })

    it('allows another recipient to retry a failed display', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        showNotification.mockRejectedValueOnce(new Error('Display failed'))
        const event = notification()
        expect(await showLocalNotification(event, text, hub)).toBe(false)
        expect(await showLocalNotification(event, text, hub)).toBe(true)
    })
})
