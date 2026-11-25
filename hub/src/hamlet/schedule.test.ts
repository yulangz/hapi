import { expect, test } from 'bun:test'
import { dailySlot } from './schedule'

test('a daily slot lands on the local wall-clock time, across offsets and DST', () => {
    // 03:59 and 04:01 Beijing time on 2026-11-25 (UTC+8, no DST)
    expect(dailySlot(Date.UTC(2026, 10, 24, 19, 59), '04:00', 'Asia/Shanghai')).toEqual({ day: '2026-11-25', at: Date.UTC(2026, 10, 24, 20, 0) })
    expect(dailySlot(Date.UTC(2026, 10, 24, 20, 1), '04:00', 'Asia/Shanghai')).toEqual({ day: '2026-11-25', at: Date.UTC(2026, 10, 24, 20, 0) })
    // New York on the day DST ends (2026-11-01) and in summer
    expect(dailySlot(Date.UTC(2026, 10, 1, 12), '04:00', 'America/New_York').at).toBe(Date.UTC(2026, 10, 1, 9, 0))
    expect(dailySlot(Date.UTC(2026, 6, 1, 12), '04:00', 'America/New_York').at).toBe(Date.UTC(2026, 6, 1, 8, 0))
})
