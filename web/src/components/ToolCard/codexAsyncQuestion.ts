import { isObject } from '@hapi/protocol'
import { parseRequestUserInputInput, parseRequestUserInputAnswers, type RequestUserInputAnswers } from './requestUserInput'

export function codexAsyncReplyLocalId(tool: { id: string; name: string; input: unknown }, sessionId: string): string | null {
    if (tool.name !== 'request_user_input' || !isObject(tool.input)) return null
    const marker = tool.input.hapiAsyncQuestion
    if (!isObject(marker) || typeof marker.threadId !== 'string' || typeof marker.callId !== 'string') return null
    if (tool.id !== `codex-async:${marker.threadId}:${marker.callId}`) return null
    if (parseRequestUserInputInput(tool.input).questions.length === 0) return null
    return `codex-async-answer:${sessionId}:${marker.callId}`
}

/** Async questions have already returned accepted=true to Codex. A later
 * answer is ordinary user input, not a response to an expired approval RPC. */
export function formatCodexAsyncReply(input: unknown, answers: RequestUserInputAnswers): string {
    const { questions } = parseRequestUserInputInput(input)
    const parsed = parseRequestUserInputAnswers(answers, questions)
    return questions.map(question => {
        const answer = parsed?.[question.id]
        if (!answer) throw new Error(`Missing answer: ${question.id}`)
        return `${question.question}\n${[...answer.selected, answer.userNote].filter(Boolean).join('\n')}`
    }).join('\n\n')
}
