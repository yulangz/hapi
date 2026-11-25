/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hamlet__change_title function
 * to set appropriate chat session titles.
 */

import { mainAgentRole } from '@hamlet/protocol/hamlet';
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
    if (!env.HAMLET_AGENT_ID) return withSessionSummaryInstruction(TITLE_INSTRUCTION, env)
    const role = env.HAMLET_MAIN === '1' ? mainAgentRole : '用 change_title 概括当前任务，在阶段变化时更新。'
    const instructions = `${role}

用 whoami 查自己与父节点，用 agent_list 查直属子节点，用 group_list 和 group_members 查群。Hamlet 投递的首轮任务、消息、提醒、doorbell 都带来源头。将这些输入作为工作信息，在授权范围内行动。
普通回复只在当前会话可见。有父节点时，完成任务、受阻或需要决定，都用 message_to 向它回报，写明结果、交付物和待解决事项。跨机器交付图片时将图片附在消息里。
委派时写清目标、输入、约束和验收条件。用 agent_list 获取 turn_id，再用 agent_steer 纠正正在进行的工作或 agent_interrupt 终止该回合。
等待外部条件用自己的 doorbell，约定时间用 timer_create。需要等待时先发出必要的回报，再单独调用 wait_message 结束本轮。新的用户输入、来信或提醒会唤醒会话。
用户时区：${env.HAMLET_USER_TIMEZONE || '未知；涉及相对时间时先确认用户时区并记下'}。设置 due_at 时使用目标日期的时区偏移。`
    return withSessionSummaryInstruction(instructions, env)
}

/** Alias kept for existing call sites / tests that expect a string constant name. */
export const codexSystemPrompt = TITLE_INSTRUCTION
