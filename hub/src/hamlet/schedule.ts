/** Offset of `zone` from UTC at `instant`, in milliseconds (local minus UTC). */
function zoneOffset(zone: string, instant: number): number {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(instant).map((p) => [p.type, Number(p.value)]),
    )
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant / 1000) * 1000
}

/**
 * Today's occurrence of a daily `HH:MM` in `zone`, as seen at `now`:
 * `day` is the local date (YYYY-MM-DD) and `at` the instant it falls on.
 */
export function dailySlot(now: number, time: string, zone: string): { day: string; at: number } {
    const [hour, minute] = time.split(':').map(Number)
    const local = new Date(now + zoneOffset(zone, now))
    const day = local.toISOString().slice(0, 10)
    const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute)
    const at = guess - zoneOffset(zone, guess - zoneOffset(zone, guess))
    return { day, at }
}
