/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hamlet__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';
import { buildSessionCitationSteerInstruction } from '@hamlet/protocol/sessionCitation';
import { DISPLAY_IMAGE_PROMPT_CODEX, DISPLAY_MEDIA_PROMPT_CODEX, DISPLAY_VIDEO_PROMPT_CODEX } from '@/modules/common/displayImagePrompt';
import { withSessionSummaryInstruction } from '@/modules/common/sessionSummaryInstruction';

/**
 * Title instruction for Codex to call the hamlet MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hamlet__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Use the title tool sparingly. For a new chat, call it once after the user's initial request is clear, and set a concise task title.
    Prefer calling functions.hamlet__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hamlet__change_title, mcp__hamlet__change_title, or hamlet_change_title.
    Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording.
    Rename only when the user's primary objective changes substantially and the existing title would be misleading.
    ${DISPLAY_IMAGE_PROMPT_CODEX}
    ${DISPLAY_VIDEO_PROMPT_CODEX}
    ${DISPLAY_MEDIA_PROMPT_CODEX}
    ${buildSessionCitationSteerInstruction({
        inspectTool: 'functions.hamlet__inspect_peer',
        pingTool: 'functions.hamlet__ping_peer',
        listPeersTool: 'functions.hamlet__list_peers',
    })}
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 * Session-summary contract is resolved at call time (hub toggle / env).
 *
 * Hamlet managed sessions add nothing here: they run on Codex's own base
 * instructions, and everything Hamlet-specific is carried by the tool
 * descriptions (always present, never compacted) and by the bundled guide.
 */
export function getCodexSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    if (env.HAMLET_AGENT_ID) return ''
    return withSessionSummaryInstruction(TITLE_INSTRUCTION, env)
}

/** Alias kept for existing call sites / tests that expect a string constant name. */
export const codexSystemPrompt = TITLE_INSTRUCTION
