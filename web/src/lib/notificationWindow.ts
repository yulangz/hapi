/** matchAll returns windows in most-recently-focused order. */
export async function openNotificationWindow(clients: Clients, scope: string, notificationUrl?: string) {
    const target = new URL(notificationUrl ?? scope, scope)
    const inScope = (href: string) => href.startsWith(scope)
    if (!inScope(target.href)) {
        await clients.openWindow(target.href)
        return
    }
    const windows = (await clients.matchAll({ type: 'window', includeUncontrolled: true }))
        .filter(client => client.frameType !== 'nested' && inScope(client.url))
    const exact = windows.find(client => client.url === target.href)
    for (const client of exact ? [exact, ...windows.filter(other => other !== exact)] : windows) {
        try {
            await client.focus()
        } catch {
            continue // The tab may have closed since matchAll.
        }
        // Remote Push deliberately carries only the app scope. Keep the user's place.
        if (target.href !== scope && client.url !== target.href) {
            if (!await client.navigate(target.href).catch(() => null)) continue
        }
        return
    }
    await clients.openWindow(target.href)
}
