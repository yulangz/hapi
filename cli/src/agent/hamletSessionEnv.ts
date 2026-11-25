import { configuration } from '@/configuration';

/**
 * Canonical env var name exported into the wrapped agent / CLI child process so
 * it can self-target its own hub session (REST, shell helpers) without listing
 * `/api/sessions`. See tiann/hapi#1119.
 */
export const HAMLET_SESSION_ID_ENV = 'HAMLET_SESSION_ID';

/**
 * Publish the hub session id into `process.env` so every downstream agent spawn
 * inherits it. HAMLET runs one hub session per CLI process (the runner forks a
 * fresh `hamlet` child per session, and local invocations are 1:1), and every
 * flavor's agent spawn derives its child env from `process.env` — so setting it
 * here covers claude / codex / copilot / cursor / gemini / opencode / kimi / grok / pi at
 * once, including future flavors, without touching each launcher.
 *
 * Prefer the MCP `display_image` tool for inline media when it is available;
 * `HAMLET_SESSION_ID` is the deterministic fallback for hub REST and shell tooling.
 * To discover / read / message another session, prefer MCP `list_peers` /
 * `inspect_peer` / `ping_peer` (or `hamlet ping-peer --list` / `inspect-peer` /
 * `ping-peer`) - do not reinvent JWT+curl.
 *
 * For lazy Codex sessions the id must only be exported after the hub row is
 * materialized — exporting the provisional id early makes GET /api/sessions/:id
 * fail until materialize completes.
 */
export function exportHamletSessionEnv(sessionId: string): void {
    if (!sessionId) {
        return;
    }
    process.env[HAMLET_SESSION_ID_ENV] = sessionId;
}

/**
 * Mirror an explicit hub URL into `process.env` so child shells that spawn a
 * fresh `hamlet` hit the same non-default hub the session CLI resolved from env
 * or settings. Never export the implicit localhost default (breaks hub
 * auto-start — #1372) and never mirror `CLI_API_TOKEN` into the agent
 * environment (settings/prompt-backed secrets must stay out of wrapped agents;
 * a fresh `hamlet` re-reads settings, and env-backed tokens already inherit).
 *
 * Prefer MCP `list_peers` when available - it uses in-process credentials.
 * See tiann/hapi#1371.
 */
export type ExportHamletHubAuthEnvOptions = {
    /** When true, mirror `configuration.apiUrl` into `HAMLET_API_URL`. */
    exportApiUrl?: boolean
}

export function exportHamletHubAuthEnv(options: ExportHamletHubAuthEnvOptions = {}): void {
    if (!options.exportApiUrl) {
        return;
    }
    const apiUrl = configuration.apiUrl?.trim();
    if (apiUrl) {
        process.env.HAMLET_API_URL = apiUrl;
    }
}
