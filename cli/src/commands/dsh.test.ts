import { describe, expect, it } from 'vitest'
import { parseDshCommandOptions } from './dsh'

describe('parseDshCommandOptions', () => {
    it('forces remote mode and accepts an existing HAMLET row', () => {
        expect(parseDshCommandOptions([
            '--hamlet-starting-mode', 'remote',
            '--existing-session-id', 'hamlet-session'
        ])).toEqual({
            startingMode: 'remote',
            existingSessionId: 'hamlet-session'
        })
    })

    it('rejects native resume, model, and HAMLET permission controls unsupported by DSH ACP', () => {
        expect(() => parseDshCommandOptions(['--resume', 'native-id']))
            .toThrow('fresh sessions')
        expect(() => parseDshCommandOptions(['--model', 'deepseek-v4-pro']))
            .toThrow('configured by the ACP server')
        expect(() => parseDshCommandOptions(['--yolo']))
            .toThrow('permission policy')
    })
})
