import { describe, expect, it } from 'vitest'
import { getPathDisplayName } from './path'

describe('getPathDisplayName', () => {
    it('keeps the final two segments for nested POSIX paths', () => {
        expect(getPathDisplayName('/home/user/coding/hamlet')).toBe('coding/hamlet')
    })

    it('supports Windows path separators', () => {
        expect(getPathDisplayName('C:\\Users\\Ananovo\\Downloads\\Agent\\Hamlet')).toBe('Agent/Hamlet')
    })

    it('keeps short paths and the fallback group unchanged', () => {
        expect(getPathDisplayName('hamlet')).toBe('hamlet')
        expect(getPathDisplayName('Other')).toBe('Other')
        expect(getPathDisplayName('')).toBe('')
    })
})
