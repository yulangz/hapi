import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { CodexAsyncQuestionFooter } from './CodexAsyncQuestionFooter'
import { ToolCard } from './ToolCard'
import { codexAsyncReplyLocalId, formatCodexAsyncReply } from './codexAsyncQuestion'

vi.mock('@/hooks/usePlatform', () => ({ usePlatform: () => ({ haptic: { notification: vi.fn(), selection: vi.fn() } }) }))
vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div> }))
vi.mock('@/lib/message-window-store', () => {
    const state = { messages: [] }
    return { getMessageWindowState: () => state, subscribeMessageWindow: () => () => {} }
})

const tool = {
    id: 'codex-async:thread:call_ask', name: 'request_user_input', state: 'completed', createdAt: 0,
    input: { hapiAsyncQuestion: { threadId: 'thread', callId: 'call_ask' },
        questions: [{ id: '0', question: 'Which setup?', isOther: true, options: [{ label: 'Run' }, { label: 'Prepare' }] }] }
} as unknown as ChatToolCall
const emptyState = { queuedLocalIds: [], indeterminateLocalIds: [], invokedLocalMessages: [] }

function fixture(question = tool) {
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const approvePermission = vi.fn()
    const getQueuedState = vi.fn().mockResolvedValue(emptyState)
    const api = { sendMessage, approvePermission, getQueuedState } as unknown as ApiClient
    const mount = (wholeCard = false) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {wholeCard ? <ToolCard api={api} sessionId="session" metadata={null} terminalToolDisplayMode="compact"
            disabled={false} onDone={() => {}} block={{ kind: 'tool-call', id: 'card', createdAt: 0, children: [], tool: question } as never} />
            : <CodexAsyncQuestionFooter api={api} sessionId="session" tool={question} disabled={false} onDone={() => {}} />}
    </QueryClientProvider>)
    return { sendMessage, approvePermission, getQueuedState, mount }
}

describe('Codex async questions', () => {
    it('shows the form in a completed tool card even without any pending approval', async () => {
        const f = fixture()
        f.mount(true)
        await waitFor(() => expect(screen.getByRole('button', { name: /Run$/ })).not.toBeDisabled())
        expect(screen.getByRole('button', { name: 'tool.submit' })).toBeInTheDocument()
        expect(f.approvePermission).not.toHaveBeenCalled()
    })
    it('does not recognize ordinary blocking questions or forged correlation IDs', () => {
        expect(codexAsyncReplyLocalId({ ...tool, input: { questions: [] } }, 'session')).toBeNull()
        expect(codexAsyncReplyLocalId({ ...tool, id: 'different-call' }, 'session')).toBeNull()
        expect(codexAsyncReplyLocalId(tool, 'other-session')).not.toBe(codexAsyncReplyLocalId(tool, 'session'))
    })

    it('submits a selected answer as a user message, with no approval RPC, and remembers it after remount', async () => {
        const f = fixture()
        const first = f.mount()
        const submit = await screen.findByRole('button', { name: 'tool.submit' })
        await waitFor(() => expect(submit).not.toBeDisabled())
        fireEvent.click(screen.getByRole('button', { name: /Run$/ }))
        fireEvent.click(submit)
        await screen.findByText('tool.asyncQuestion.sent')
        expect(f.sendMessage).toHaveBeenCalledExactlyOnceWith('session', 'Which setup?\nRun',
            'codex-async-answer:session:call_ask', undefined, undefined, 'queue')
        expect(f.approvePermission).not.toHaveBeenCalled()
        first.unmount()
        f.getQueuedState.mockResolvedValue({ ...emptyState, invokedLocalMessages: [{ localId: 'codex-async-answer:session:call_ask', invokedAt: 123 }] })
        f.mount()
        await screen.findByText('tool.asyncQuestion.sent')
        expect(screen.queryByRole('button', { name: 'tool.submit' })).not.toBeInTheDocument()
        expect(f.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('keeps an uncertain attempt locked and retries the identical body and id', async () => {
        const f = fixture()
        f.sendMessage.mockRejectedValueOnce(new Error('Connection lost'))
        f.mount()
        const submit = await screen.findByRole('button', { name: 'tool.submit' })
        await waitFor(() => expect(submit).not.toBeDisabled())
        fireEvent.click(screen.getByRole('button', { name: /Run$/ }))
        fireEvent.click(submit)
        await screen.findByText('Connection lost')
        expect(screen.getByRole('button', { name: /Prepare$/ })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'tool.submit' }))
        await screen.findByText('tool.asyncQuestion.sent')
        expect(f.sendMessage).toHaveBeenCalledTimes(2)
        expect(f.sendMessage.mock.calls[1]).toEqual(f.sendMessage.mock.calls[0])
    })

    it('supports a pure free-text question', async () => {
        const f = fixture({ ...tool, input: { ...tool.input as object, questions: [{ id: '0', question: 'Constraints?', options: [] }] } })
        f.mount()
        const submit = await screen.findByRole('button', { name: 'tool.submit' })
        await waitFor(() => expect(submit).not.toBeDisabled())
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Only four GPUs' } })
        fireEvent.click(submit)
        await screen.findByText('tool.asyncQuestion.sent')
        expect(f.sendMessage.mock.calls[0][1]).toBe('Constraints?\nOnly four GPUs')
    })

    it('blocks a first submission while authoritative duplicate checking is unavailable', async () => {
        const f = fixture()
        f.getQueuedState.mockRejectedValueOnce(new Error('Offline'))
        f.mount()
        await screen.findByText('tool.asyncQuestion.checkFailed')
        expect(screen.getByRole('button', { name: 'tool.submit' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'tool.submit' })).not.toBeDisabled())
        expect(f.sendMessage).not.toHaveBeenCalled()
    })

    it('formats multiple question answers together without choosing an unselected default', () => {
        expect(() => formatCodexAsyncReply(tool.input, {})).toThrow('Missing answer')
        expect(formatCodexAsyncReply({ questions: [
            { id: 'a', question: 'Setup?', options: [{ label: 'Run' }] },
            { id: 'b', question: 'Limits?', options: [] }
        ] }, { a: { answers: ['Run'] }, b: { answers: ['user_note: Four GPUs'] } })).toBe('Setup?\nRun\n\nLimits?\nFour GPUs')
    })
})
