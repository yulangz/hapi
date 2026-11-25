import { describe, expect, it } from 'vitest'
import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { renderHook } from '@testing-library/react'
import { DecryptedMessageSchema } from '@hamlet/protocol/schemas'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { buildVisibleChatBlocks, type VisibleChatBlock } from '@/chat/toolGroups'
import { useHappyRuntime } from '@/lib/assistant-runtime'
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

describe('copying stored Codex replies', () => {
    function reduceStoredMessages(data: Record<string, unknown>[]) {
        const messages = data.flatMap((record, index) => normalizeDecryptedMessage(DecryptedMessageSchema.parse({
            id: `message-${index}`,
            seq: index + 1,
            localId: null,
            createdAt: index,
            content: { role: 'agent', content: { type: 'codex', data: record } }
        })) ?? [])
        return reduceChatBlocks(messages, null).blocks
    }

    function useStoredRuntime({ blocks }: { blocks: VisibleChatBlock[] }) {
        return useHappyRuntime({
            session: { active: true, thinking: false } as Parameters<typeof useHappyRuntime>[0]['session'],
            blocks,
            messagesVersion: 1,
            historyVersion: 1,
            viewMode: 'history',
            isSending: false,
            onSendMessage: () => {},
            onAbort: async () => {}
        })
    }

    function readCopyText(runtime: ReturnType<typeof useStoredRuntime>) {
        const [assistant] = runtime.thread.getState().messages
        if (assistant?.role !== 'assistant') throw new Error('Expected a joined assistant message')
        return getAssistantCopyText(assistant.content)
    }

    function copyStoredMessages(data: Record<string, unknown>[]): string {
        const blocks = buildVisibleChatBlocks(reduceStoredMessages(data), { hasMoreMessages: false })
        const { result } = renderHook(useStoredRuntime, { initialProps: { blocks } })
        return readCopyText(result.current)
    }

    const tool = { type: 'tool-call', callId: 'call-1', name: 'CodexBash', input: { command: 'test' } }
    const result = { type: 'tool-call-result', callId: 'call-1', output: 'tool output' }
    const commentary = { type: 'message', phase: 'commentary', message: 'I have the result. I will verify it.' }

    it.each([
        { phase: 'commentary', following: [], before: 'Original **text**.', after: '' },
        { phase: 'final_answer', following: [{ type: 'message', phase: 'final_answer', message: 'Second block.' }],
            before: 'Second block.', after: 'Original **text**.\n\nSecond block.' }
    ])('updates the existing reply when $phase arrives after first render', ({ phase, following, before, after }) => {
        const rows = [tool, result, { type: 'message', id: 'original', message: 'Original **text**.' }, ...following]
        const first = reconcileChatBlocks(reduceStoredMessages(rows), new Map())
        const visible = (blocks: typeof first.blocks) => buildVisibleChatBlocks(blocks, { hasMoreMessages: false })
        const rendered = renderHook(useStoredRuntime, { initialProps: { blocks: visible(first.blocks) } })
        expect(readCopyText(rendered.result.current)).toBe(before)

        const corrected = reconcileChatBlocks(reduceStoredMessages([
            ...rows, { type: 'message-phase', id: 'original', phase }
        ]), first.byId)
        expect(corrected.blocks.map(block => block.id)).toEqual(first.blocks.map(block => block.id))
        expect(corrected.blocks.filter(block => block.id === 'original')).toEqual([
            expect.objectContaining({ kind: 'agent-text', phase, text: 'Original **text**.' })
        ])
        rendered.rerender({ blocks: visible(corrected.blocks) })
        expect(readCopyText(rendered.result.current)).toBe(after)
    })

    it('copies all final blocks and excludes progress after a tool result', () => {
        expect(copyStoredMessages([
            tool, result, commentary,
            { type: 'message', id: 'first-final', message: 'Verified **result**.' },
            { type: 'message', phase: 'finalAnswer', message: '    indented code\n' },
            { type: 'message-phase', id: 'first-final', phase: 'final_answer' }
        ])).toBe('Verified **result**.\n\n    indented code\n')
    })

    it('does not copy commentary when the turn ends without a final answer', () => {
        expect(copyStoredMessages([
            tool, result,
            { type: 'message', id: 'late-commentary', message: commentary.message },
            { type: 'message-phase', id: 'late-commentary', phase: 'commentary' }
        ])).toBe('')
    })

    it('applies phase corrections on the original side of a later tool boundary', () => {
        expect(copyStoredMessages([
            { type: 'message', id: 'before-tool', message: 'Older text.' },
            tool, result,
            { type: 'message-phase', id: 'before-tool', phase: 'final_answer' },
            { type: 'message-phase', id: 'outside-history-window', phase: 'final_answer' }
        ])).toBe('')
    })

    it.each([undefined, 'final_answer', 'futurePhase'])('copies a plan preface followed by its synthetic plan card (%s)', (phase) => {
        const callId = 'codex-proposed-plan:plan-1'
        expect(copyStoredMessages([
            tool, result,
            { type: 'message', phase, message: 'Plan **preface**.' },
            { type: 'tool-call', name: 'ExitPlanMode', callId, input: { plan: '## Proposed plan' } },
            { type: 'tool-call-result', callId, output: null }
        ])).toBe('Plan **preface**.')
    })

    it('continues to use real ExitPlanMode calls as tool boundaries', () => {
        expect(copyStoredMessages([
            { type: 'message', message: 'Pre-tool text' },
            { type: 'tool-call', name: 'ExitPlanMode', callId: 'actual-tool', input: { plan: '## Actual plan' } },
            { type: 'tool-call-result', callId: 'actual-tool', output: null }
        ])).toBe('')
    })
})
