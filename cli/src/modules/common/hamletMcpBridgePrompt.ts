import { trimIdent } from '@/utils/trimIdent';
import {
    DISPLAY_IMAGE_PROMPT_HAMLET_MCP,
    DISPLAY_MEDIA_PROMPT_HAMLET_MCP,
    DISPLAY_VIDEO_PROMPT_HAMLET_MCP,
} from './displayImagePrompt';

/** Shell fallback for `hamlet doctor inline-media` only — not injected into agent prompts. */
export const INLINE_MEDIA_SHELL_FALLBACK = trimIdent(`
    If display_image / display_video / display_media tools are not in your tool list, inline media via shell from the HAMLET repo (needs bun + @modelcontextprotocol/sdk):
    cd <hamlet-repo-root> && bun scripts/tooling/hamlet-display-image.mjs <HAMLET-session-id-prefix> <absolute-file-path> "title"
    Use the HAMLET session uuid prefix from the web URL /sessions/<uuid> (first 8 chars), not cursorSessionId or other agent-native ids.
    Run hamlet doctor inline-media to list active bridges and copy the exact command.
`);

/**
 * Title + display_image / display_video / display_media instructions for OpenCode first-prompt /
 * hamlet-instructions.md. Cursor uses native MCP overlay + tool descriptions instead
 * (no user-turn prepend — that path was prompt-taint).
 */
export const HAMLET_MCP_TITLE_INSTRUCTION = trimIdent(`
    Use the title tool sparingly. For a new chat, call the tool "hamlet_change_title" once after the user's initial request is clear, and set a concise task title. Do not rename the chat for routine progress, substeps, implementation details, or a slightly better wording. Rename only when the user's primary objective changes substantially and the existing title would be misleading.
`);

export const HAMLET_MCP_BRIDGE_PROMPT = trimIdent(`
    ${HAMLET_MCP_TITLE_INSTRUCTION}
    ${DISPLAY_IMAGE_PROMPT_HAMLET_MCP}
    ${DISPLAY_VIDEO_PROMPT_HAMLET_MCP}
    ${DISPLAY_MEDIA_PROMPT_HAMLET_MCP}
`);
