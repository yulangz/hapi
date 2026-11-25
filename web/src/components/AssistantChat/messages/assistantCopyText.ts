import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { stripNotifySummaryFooter } from '@hamlet/protocol/messages'

export function getAssistantCopyText(
    parts: readonly ThreadAssistantMessagePart[],
    options?: { stripNotifySummary?: boolean }
): string {
    // assistant-ui joins the entire tool loop into one assistant message. The
    // stored chat parts have no reply phase, so use the last tool as the
    // boundary for the final reply. With no tools, keep all text parts.
    const lastToolIndex = parts.findLastIndex((part) => part.type === 'tool-call')
    return getAssistantMessageText(lastToolIndex < 0 ? parts : parts.slice(lastToolIndex + 1), {
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
