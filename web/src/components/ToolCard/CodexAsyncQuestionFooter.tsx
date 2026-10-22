import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { getMessageWindowState, subscribeMessageWindow } from '@/lib/message-window-store'
import { useTranslation } from '@/lib/use-translation'
import { Button } from '@/components/ui/button'
import { RequestUserInputFooter } from './RequestUserInputFooter'
import { codexAsyncReplyLocalId, formatCodexAsyncReply } from './codexAsyncQuestion'
import type { RequestUserInputAnswers } from './requestUserInput'

export function CodexAsyncQuestionFooter(props: {
    api: ApiClient; sessionId: string; tool: ChatToolCall; disabled: boolean; onDone: () => void
}) {
    const { t } = useTranslation()
    const localId = codexAsyncReplyLocalId(props.tool, props.sessionId)
    const state = useSyncExternalStore(
        useCallback(listener => subscribeMessageWindow(props.sessionId, listener), [props.sessionId]),
        useCallback(() => getMessageWindowState(props.sessionId), [props.sessionId])
    )
    const query = useQuery({
        queryKey: ['codex-async-answer', props.sessionId, localId],
        queryFn: () => props.api.getQueuedState(props.sessionId, [localId!]),
        enabled: localId !== null,
        staleTime: 0,
        retry: false
    })
    const [sent, setSent] = useState(false)
    const [locked, setLocked] = useState(false)
    const payload = useRef<string | null>(null)
    const inFlight = useRef(false)
    const exists = localId !== null && (state.messages.some(m => m.localId === localId && m.status !== 'failed')
        || query.data?.queuedLocalIds.includes(localId)
        || query.data?.indeterminateLocalIds?.includes(localId)
        || query.data?.invokedLocalMessages.some(m => m.localId === localId))

    if (!localId) return null
    if (sent || exists) return <div role="status" className="mt-3 text-sm text-[var(--app-hint)]">{t('tool.asyncQuestion.sent')}</div>
    const submitAnswers = async (answers: RequestUserInputAnswers) => {
        if (inFlight.current || props.disabled || exists || sent || (!query.isSuccess && payload.current === null)) return
        // Pin the first payload: retry after an uncertain HTTP outcome must
        // use the same body and id, even if the browser missed the SSE echo.
        payload.current ??= formatCodexAsyncReply(props.tool.input, answers)
        inFlight.current = true
        setLocked(true)
        try {
            await props.api.sendMessage(props.sessionId, payload.current, localId, undefined, undefined, 'queue')
            setSent(true)
            void query.refetch()
        } catch (error) {
            void query.refetch()
            throw error
        } finally { inFlight.current = false }
    }

    return <>
        {query.isError ? <div className="mt-3 space-y-2">
            <div role="alert" className="text-sm text-[var(--app-badge-error-text)]">{t('tool.asyncQuestion.checkFailed')}</div>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('common.retry')}</Button>
        </div> : null}
        <RequestUserInputFooter {...props} disabled={props.disabled || (!query.isSuccess && !locked)}
            submitAnswers={submitAnswers} lockAnswers={locked} />
    </>
}
