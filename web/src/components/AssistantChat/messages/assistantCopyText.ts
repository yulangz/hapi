import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { stripNotifySummaryFooter } from '@hamlet/protocol/messages'

export function getAssistantCopyText(
    parts: readonly ThreadAssistantMessagePart[],
    options?: { stripNotifySummary?: boolean }
): string {
    // Codex emits a synthetic presentation card after the visible plan reply.
    // A real ExitPlanMode call still delimits the tool loop.
    const lastToolIndex = parts.findLastIndex((part) => part.type === 'tool-call' && !(
        part.toolName === 'ExitPlanMode'
        && part.toolCallId.startsWith('codex-proposed-plan:')
        && typeof part.args.plan === 'string'
    ))
    const texts = parts.slice(lastToolIndex + 1).filter((part) => part.type === 'text')
    const final = texts.filter((part) => {
        const phase = part.providerMetadata?.codex?.phase
        return phase === 'final_answer' || phase === 'finalAnswer'
    })
    const reply = final.length ? final : texts.filter((part) => part.providerMetadata?.codex?.phase !== 'commentary')
    return getAssistantMessageText(reply, {
        ...options,
        preserveWhitespace: true
    })
}

export function getAssistantMessageText(
    parts: readonly ThreadAssistantMessagePart[],
    options?: { stripNotifySummary?: boolean; preserveWhitespace?: boolean }
): string {
    const strip = options?.stripNotifySummary === true
    return parts
        .filter((part) => part.type === 'text')
        .map((part) => {
            const text = options?.preserveWhitespace ? part.text : part.text.trim()
            return strip ? stripNotifySummaryFooter(text) : text
        })
        .filter((text) => text.trim().length > 0)
        .join('\n\n')
}
