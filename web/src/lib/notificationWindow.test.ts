import { expect, it, vi } from 'vitest'
import { openNotificationWindow } from './notificationWindow'

const scope = 'https://example.test/hamlet/'
const target = scope + 'sessions/main'

function tab(url: string) {
    return { url, frameType: 'top-level', focus: vi.fn().mockResolvedValue({}), navigate: vi.fn().mockResolvedValue({}) }
}

function browser(...windows: ReturnType<typeof tab>[]) {
    const openWindow = vi.fn()
    const clients = { matchAll: vi.fn().mockResolvedValue(windows), openWindow } as unknown as Clients
    return { clients, openWindow }
}

it('focuses the existing session without reloading it or opening a duplicate', async () => {
    const recent = tab(scope + 'settings')
    const session = tab(target)
    const { clients, openWindow } = browser(recent, session)
    await openNotificationWindow(clients, scope, target)
    expect(session.focus).toHaveBeenCalledOnce()
    expect(session.navigate).not.toHaveBeenCalled()
    expect(recent.focus).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
})

it('keeps the most recent app window on its current page for a generic push', async () => {
    const settings = tab(scope + 'settings')
    const { clients, openWindow } = browser(tab('https://example.test/elsewhere'), settings, tab(target))
    await openNotificationWindow(clients, scope, scope)
    expect(settings.focus).toHaveBeenCalledOnce()
    expect(settings.navigate).not.toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
})

it('navigates an existing app window to the session when the matching tab has closed', async () => {
    const closed = tab(target)
    closed.focus.mockRejectedValue(new Error('closed'))
    const settings = tab(scope + 'settings')
    const { clients, openWindow } = browser(settings, closed)
    await openNotificationWindow(clients, scope, target)
    expect(settings.navigate).toHaveBeenCalledWith(target)
    expect(openWindow).not.toHaveBeenCalled()
})

it('opens the app when no eligible window is available', async () => {
    const frame = tab(target)
    frame.frameType = 'nested'
    const { clients, openWindow } = browser(frame)
    await openNotificationWindow(clients, scope, target)
    expect(frame.focus).not.toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith(target)
})
