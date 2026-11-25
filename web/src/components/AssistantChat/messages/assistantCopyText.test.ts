import { describe, expect, it } from 'vitest'
import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { getAssistantCopyText } from '@/components/AssistantChat/messages/assistantCopyText'

describe('getAssistantCopyText', () => {
    it('keeps all text blocks in a tool-free reply and skips reasoning', () => {
        const parts = [
            { type: 'text', text: 'First paragraph.' },
            { type: 'reasoning', text: 'Hidden chain of thought' },
            { type: 'text', text: 'Second paragraph.' }
        ] satisfies ThreadAssistantMessagePart[]

        expect(getAssistantCopyText(parts)).toBe('First paragraph.\n\nSecond paragraph.')
    })

    it('copies every final text block after the last tool, preserving Markdown and paragraphs', () => {
        const parts = [
            { type: 'text', text: 'I will inspect.' },
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'search', args: {}, argsText: '{}', result: 'First result' },
            { type: 'text', text: 'I found a lead.' },
            { type: 'tool-call', toolCallId: 'tool-2', toolName: 'ToolGroup', args: {}, argsText: '{}', result: 'Second result' },
            { type: 'text', text: '**Final** answer.\n\n- First bullet' },
            { type: 'reasoning', text: 'Hidden chain of thought' },
            { type: 'text', text: '    indented code\n    next line\n' }
        ] satisfies ThreadAssistantMessagePart[]

        expect(getAssistantCopyText(parts)).toBe('**Final** answer.\n\n- First bullet\n\n    indented code\n    next line\n')
    })

    it('returns empty string when the tool loop has no final answer', () => {
        const parts = [
            { type: 'text', text: 'I will inspect.' },
            { type: 'tool-call', toolCallId: 'tool-1', toolName: 'search', args: {}, argsText: '{}' },
            { type: 'reasoning', text: 'Thinking' },
            { type: 'text', text: '\n  ' }
        ] satisfies ThreadAssistantMessagePart[]

        expect(getAssistantCopyText(parts)).toBe('')
    })

    it('strips trailing AGENT_NOTIFY_SUMMARY when stripNotifySummary is on', () => {
        const parts = [
            {
                type: 'text',
                text: 'Did the work.\n\nAGENT_NOTIFY_SUMMARY {"summary":"Done","status":"done"}'
            }
        ] satisfies ThreadAssistantMessagePart[]

        expect(getAssistantCopyText(parts, { stripNotifySummary: true })).toBe('Did the work.')
        expect(getAssistantCopyText(parts)).toContain('AGENT_NOTIFY_SUMMARY')
    })
})
