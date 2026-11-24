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
 */
export function getCodexSystemPrompt(env: NodeJS.ProcessEnv = process.env): string {
    let instructions = env.HAMLET_AGENT_ID
        ? 'Use change_title to describe your current work. Use whoami, agent_list, group_list and group_members to discover your collaborators. Use message_to for normal text and images. To correct a running direct child, use agent_list to get its turn_id, then agent_steer to intervene in that turn or agent_interrupt to request that it stop. Use display_media to show an attachment to the user. Timers and doorbells wake your own session. When your remaining work depends on another agent or an external event, report any needed update first, then call wait_message alone as your final action. A new user message, reply or event starts the next turn.'
        : TITLE_INSTRUCTION;
    if (env.HAMLET_AGENT_ID && env.HAMLET_MAIN === '1') {
        instructions += ' Delegate the entire operational task, including setup, watching for files or external changes, checking conditions for reminders, and processing arrivals. The assigned child creates its own doorbell on its runner and reports by message_to, with attachments where relevant. Keep personal timers for coordination deadlines. After dispatch, yield with wait_message. Use replies as your source of progress; do not poll child sessions, inspect directories, or reproduce their work while waiting.'
    }
    return withSessionSummaryInstruction(instructions, env)
}

/** Alias kept for existing call sites / tests that expect a string constant name. */
export const codexSystemPrompt = TITLE_INSTRUCTION
