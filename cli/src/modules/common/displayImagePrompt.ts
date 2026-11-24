import { trimIdent } from '@/utils/trimIdent';

/**
 * Shared display_image MCP tool hints — one export per tool naming convention.
 * Inject into flavor system prompts and first-prompt bridge instructions.
 */
export const DISPLAY_IMAGE_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local image file that the human user should see, call the tool "mcp__hamlet__display_image" with the absolute filesystem path so HAMLET can show it inline.
    This tool sends the image to the human user for inline display in HAMLET. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_IMAGE_PROMPT_CODEX = trimIdent(`
    When you create or find a local image file that the human user should see, call functions.hamlet__display_image with the absolute filesystem path. If that exact tool name is unavailable, use an equivalent alias such as hamlet__display_image, mcp__hamlet__display_image, or hamlet_display_image.
    This tool sends the image to the human user for inline display in HAMLET. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_IMAGE_PROMPT_HAMLET_MCP = trimIdent(`
    When you create or find a local image file that the human user should see, call the tool "hamlet_display_image" with the absolute filesystem path so HAMLET can show it inline. If that exact tool name is unavailable, use an equivalent alias such as display_image or mcp__hamlet__display_image.
    This tool sends the image to the human user for inline display in HAMLET. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_VIDEO_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "mcp__hamlet__display_video" with the file path so HAMLET can show it inline.
`);

export const DISPLAY_VIDEO_PROMPT_CODEX = trimIdent(`
    When you create or find a local mp4 or webm file the user should see, call functions.hamlet__display_video with the file path. If that exact tool name is unavailable, use an equivalent alias such as hamlet__display_video, mcp__hamlet__display_video, or hamlet_display_video.
`);

export const DISPLAY_VIDEO_PROMPT_HAMLET_MCP = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "hamlet_display_video" with the file path so HAMLET can show it inline. If that exact tool name is unavailable, use an equivalent alias such as display_video or mcp__hamlet__display_video.
`);

export const DISPLAY_IMAGE_PROMPT_CURSOR = trimIdent(`
    When you create or find a local image file that the human user should see, call the tool "display_image" with the absolute filesystem path so HAMLET can show it inline.
    This tool sends the image to the human user for inline display in HAMLET. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_VIDEO_PROMPT_CURSOR = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "display_video" with the absolute filesystem path so HAMLET can show it inline.
`);

export const DISPLAY_MEDIA_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call the tool "mcp__hamlet__display_media" with the file path so HAMLET can show a player or download card.
`);

export const DISPLAY_MEDIA_PROMPT_CODEX = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call functions.hamlet__display_media with the file path. If that exact tool name is unavailable, use an equivalent alias such as hamlet__display_media, mcp__hamlet__display_media, or hamlet_display_media.
`);

export const DISPLAY_MEDIA_PROMPT_HAMLET_MCP = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call the tool "hamlet_display_media" with the file path. If that exact tool name is unavailable, use an equivalent alias such as display_media or mcp__hamlet__display_media.
`);

export const DISPLAY_MEDIA_PROMPT_CURSOR = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call the tool "display_media" with the absolute filesystem path so HAMLET can show a player or download card.
`);
