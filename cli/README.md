# hamlet CLI

Choose a supported coding agent from your terminal and control its sessions remotely through the hamlet hub. See the [supported agents](../docs/guide/agents.md).

Codex 0.163 async questions (`agentMessage.delivery = "async"` with `questions`)
are projected as durable question cards for the root conversation. They do not
create an approval request or block the running turn. The web form submits the
question text and chosen/free-text answers as a normal queued user message,
using one stable client message ID per question batch to prevent duplicate
replies after reconnect or uncertain HTTP outcomes. Refreshing checks the Hub's
authoritative message state before enabling the form. Child-thread questions
remain visible in their agent trace; their answers must be sent to that native
child thread rather than routed to the root conversation.

## What it does

- Starts Claude Code sessions and registers them with hamlet-hub.
- Starts Codex mode for OpenAI-based sessions.
- Starts Cursor Agent mode for Cursor CLI sessions.
- Starts Grok Build locally or via ACP for remote sessions.
- Starts OpenCode mode via ACP and its plugin hook system.
- Starts DeepSeek Harness through an external ACP stdio server.
- Provides an MCP stdio bridge for external tools.
- Manages a background runner for long-running sessions.
- Includes diagnostics and auth helpers.

## Typical flow

1. Start the hub and set env vars (see ../hub/README.md).
2. Set the same CLI_API_TOKEN on this machine or run `hamlet auth login`.
3. Run `hamlet` to choose an agent, or `hamlet <agent>` to start one directly.
4. Use the web app or Telegram Mini App to monitor and control.

## Commands

### Session commands

- `hamlet` - Choose an agent interactively. Unavailable agents are shown with a reason and cannot be selected.
- `hamlet claude` - Start a Claude Code session (passes through Claude CLI flags).
- `hamlet codex` - Start Codex mode. See `src/codex/runCodex.ts`.
- `hamlet codex resume <native-thread-id>` - Resume a Codex conversation by its native thread ID. For a HAMLET session ID, use `hamlet resume <id>`.
- `hamlet cursor` - Start Cursor Agent mode. See `src/cursor/runCursor.ts`.
  Supports `hamlet cursor resume <chatId>`, `hamlet cursor --continue`, `--mode plan|ask`, `--yolo`, `--model`.
  Local and remote modes supported; new remote sessions use `agent acp`. Pre-ACP sessions retain the legacy `agent -p` stream-json resume path.
- `hamlet grok` - Start Grok Build mode. See `src/grok/runGrok.ts`.
- `hamlet copilot` - Start GitHub Copilot mode.
- `hamlet kimi` - Start Kimi mode.
- `hamlet agy` - Start Antigravity mode (remote-only).
- `hamlet pi` - Start Pi mode (remote-only).
- `hamlet opencode` - Start OpenCode mode via ACP. See `src/opencode/runOpencode.ts`.
  Note: OpenCode supports local and remote modes; local mode streams via OpenCode plugins.
- `hamlet dsh` - Start DeepSeek Harness through ACP. See `src/dsh/runDsh.ts`.
  DSH is remote-only and its ACP server must be configured separately.
- `hamlet resume [sessionId]` - List resumable sessions for this machine or resume one locally.
- `hamlet ping-peer <session-id-prefix> <message>` - Resume (if needed) and message another session. Prefer this or MCP `ping_peer` / `list_peers` over reinventing JWT+curl. Also `--message-file` / `--list`.
- `hamlet inspect-peer <session-id-or-prefix>` - Read-only peer metadata + recent message text (no resume). Prefer this or MCP `inspect_peer` when a user cites `[title](/sessions/<id>)` or Copy-reference `See session "…" (/sessions/<id>) for context`. `/sessions/<id>` is a hub path, not a local file. Optional `--limit`.

The picker lists agents alphabetically by command name. Use Up/Down and Enter
to choose; Esc or Ctrl-C cancels. It appears on every bare invocation, even
when only one agent is available. No default agent or selection is saved.

Scripts and non-interactive shells must specify an agent. Old implicit-Claude
commands such as `hamlet --yolo`, `hamlet --resume`, and `hamlet "prompt"` now report
an error; use `hamlet claude --yolo`, `hamlet claude --resume`, or
`hamlet claude "prompt"` instead.

`hamlet --help`, `hamlet -h`, and `hamlet help` show only HAMLET's help, without starting
a session or requiring an installed agent. `hamlet --version` / `hamlet -v` show
HAMLET's version. Flags after an agent name are handled by that agent's existing
integration; supported flags vary by agent. HAMLET does not translate or append
agent help text.

### Resume a remote session locally

```bash
hamlet resume
hamlet resume <session-id>
```

`hamlet resume` lists resumable sessions for the current machine. `hamlet resume <session-id>` hands off an active remote session and opens the same HAMLET session in the local terminal.

For Codex, the terminal and Web stay usable at the same time. Closing the
original terminal stops a terminal-started run, but its history remains
resumable. Sessions started from the Web run under the Runner; closing a
terminal attached later does not stop them. **End session** archives the
selected conversation. See [Codex usage and limits](../docs/guide/codex-shared-sessions.md)
for details.

### Answer local Claude prompts from HAMLET

In a local Claude session started by `hamlet claude`, main-session `AskUserQuestion`
questions and tool permission prompts can also be answered from the web app.
The terminal dialog stays usable; answering does not restart Claude or switch
the session to remote mode. Claude arbitrates terminal/web races, and HAMLET
records the native result rather than assuming the web response won.

The bridge uses Claude's `PermissionRequest` hook, not a blocking
`PreToolUse` approval gate. An unanswered remote request expires after one
hour; expiration, disconnection, or bridge failure leaves the native prompt
available. Local answers/cancellation, session changes, and mode switches
withdraw stale web controls. Cancellation detection may wait for the next
transcript scan.

Verified with Claude Code **2.1.221**. Background subagents, `ExitPlanMode`,
and requests that cannot be unambiguously matched to a native tool call remain
terminal-only. Earlier Claude versions have not been verified.

### Authentication

- `hamlet auth status` - Show authentication configuration and token source.
- `hamlet auth login` - Interactively enter and save CLI_API_TOKEN.
- `hamlet auth logout` - Clear saved credentials.

See `src/commands/auth.ts`.

### Runner management

- `hamlet runner start` - Replace any existing runner and start a detached process with the supplied flags/environment.
- `hamlet runner stop` - Stop runner gracefully; agent sessions stay alive.
- `hamlet runner start-sync` - Run in the foreground (for a process supervisor).
- `hamlet runner status` - Show runner diagnostics.
- `hamlet runner list` - List active sessions managed by runner.
- `hamlet runner stop-session <sessionId>` - Terminate specific session.
- `hamlet runner logs` - Print path to latest runner log file.

Both `start` and `start-sync` accept repeatable `--workspace-root <path>` (or `--workspace-root=<path>`). When set:

- The web `/browse` page surfaces scoped file trees rooted at those paths.
- The runner refuses `list-directory` and `spawn-session` requests for paths outside the configured roots.
- `~` and `~/foo` are expanded.

Omitting the flag keeps manual session spawning unrestricted and leaves the
web `/browse` feature disabled. Machine directory lookups used by session
autocomplete and native pickers are still available, but are limited to the
runner's home directory.

See `src/runner/run.ts`.

### Diagnostics

- `hamlet doctor` - Show full diagnostics (version, runner status, logs, processes).
- `hamlet doctor clean` - Kill runaway HAMLET processes.

See `src/ui/doctor.ts`.

### Other

- `hamlet mcp` - Start MCP stdio bridge. See `src/codex/happyMcpStdioBridge.ts`.
- `hamlet hub` - Start the bundled hub (single binary workflow).
- `hamlet server` - Alias for `hamlet hub`.

### Codex MCP servers

Codex sessions keep the MCP servers configured in the user's Codex
`config.toml`. HAMLET adds its own `hamlet` bridge without replacing other user
servers. When a runner spawn supplies a Codex auth token, it copies only
`config.toml` into a temporary `CODEX_HOME` and writes the supplied `auth.json`,
preserving MCP settings without copying unrelated authentication state.
Without a supplied token, Codex uses the runner's normal Codex home/auth.
The `hamlet` server name is reserved by HAMLET.

On Windows, known package-manager shims (`uvx`, `npx`, `npm`, `pnpm`, `yarn`,
`bunx`, and `.cmd`/`.bat` commands) use a short-lived HAMLET stdio compatibility
proxy before reaching the configured MCP server. The proxy keeps the original
command and arguments in a session-temporary file and forwards MCP JSON-RPC
bytes without putting environment-variable values into arguments or that file.
Secret and network variables still need to be listed in the MCP entry's
`env_vars` (or supplied through `env`); HAMLET does not forward the whole host
environment automatically.

## Configuration

See `src/configuration.ts` for all options.

DeepSeek Harness ACP uses `dsh-acp-demo` by default. Override the executable or
its arguments without shell parsing:

```bash
export HAMLET_DSH_ACP_COMMAND=dsh-acp-demo
export HAMLET_DSH_ACP_CONFIG=/path/to/deepseek-harness/examples/acp-agent/cordis.yml
hamlet dsh
```

For a source checkout, use JSON arguments:

```bash
export HAMLET_DSH_ACP_COMMAND=pnpm
export HAMLET_DSH_ACP_ARGS_JSON='["--dir", "/path/to/deepseek-harness", "run", "demo:acp"]'
```

The official ACP demo is fresh-session-only and does not support native resume,
model switching, MCP injection, or live tool/reasoning telemetry. HAMLET uses the
standard chat and pending one-shot permission surfaces; the ACP composition
owns the overall permission policy and HAMLET does not advertise resume or model
controls for DSH.

### Required

- `CLI_API_TOKEN` - Shared secret; must match the hub. Can be set via env or `~/.hamlet/settings.json` (env wins).

### Optional

- `HAMLET_API_URL` - Hub base URL (default: http://localhost:3006; also configurable as `apiUrl` in settings).
- `HAMLET_HOME` - Config/data directory (default: ~/.hamlet).
- `HAMLET_EXPERIMENTAL` - Enable experimental features (true/1/yes).
- `HAMLET_EXTRA_HEADERS_JSON` - JSON object of extra headers to send on CLI → hub requests, e.g. `{"Cookie":"CF_Authorization=..."}`. Can also be set as the `extraHeaders` object in `~/.hamlet/settings.json` (environment variable wins).
- `HAMLET_CLAUDE_PATH` - Path to a specific `claude` executable.
- `HAMLET_DSH_ACP_COMMAND` - ACP server executable for `hamlet dsh` (default: `dsh-acp-demo`).
- `HAMLET_DSH_ACP_CONFIG` - Optional `dsh-acp-demo --config` path.
- `HAMLET_DSH_ACP_ARGS_JSON` - Optional JSON array of ACP server arguments.
- `HAMLET_HTTP_MCP_URL` - Default MCP target for `hamlet mcp`.

### Runner

- `HAMLET_RUNNER_HEARTBEAT_INTERVAL` - Heartbeat interval in ms (default: 60000).
- `HAMLET_RUNNER_HTTP_TIMEOUT` - HTTP timeout for runner control in ms (default: 10000).
- `HAMLET_RUNNER_WEBHOOK_TIMEOUT_MS` - Session-start webhook timeout in ms (default: 15000); raise for slow agent startup/resume.
- `HAMLET_DISABLE_VERSION_HANDOFF` - Set to `1` to disable automatic runner replacement on CLI binary changes.
- `HAMLET_RUNNER_SUPERVISED` - Set to `1` only when a supervisor restarts the runner after exit; enables the web Restart control's supervised path.

### Worktree (set by runner)

- `HAMLET_WORKTREE_BASE_PATH` - Base repository path.
- `HAMLET_WORKTREE_BRANCH` - Current branch name.
- `HAMLET_WORKTREE_NAME` - Worktree name.
- `HAMLET_WORKTREE_PATH` - Full worktree path.
- `HAMLET_WORKTREE_CREATED_AT` - Creation timestamp (ms).

### Set for the wrapped agent

- `HAMLET_SESSION_ID` - The current HAMLET session ID, available inside agent shells. Use it in scripts that target the current conversation without listing sessions.
- An explicitly configured `HAMLET_API_URL` is also made available to agent shells. HAMLET does not copy settings-backed `CLI_API_TOKEN` secrets into the agent environment; credentials already present in the parent environment may still be inherited. Web terminal PTYs strip hub secrets.

For peer discovery and messaging, use the session's MCP `list_peers`,
`inspect_peer`, and `ping_peer` tools, or the corresponding CLI commands.
On a remote runner host, configure the matching hub URL and token so shell
commands reach the same hub (`hamlet auth login` saves the token).

For example, this source-checkout helper displays an image in the current
session when MCP is unavailable:

```bash
bun scripts/tooling/hamlet-display-image.mjs /absolute/path/to/image.png "optional title"
```

## Session lifecycle invariants

When changing agent bootstrap, handoff, or shared-session plumbing:

- Handoff-capable integrations use `local` (terminal) and `remote` (web-controlled) ownership modes. Codex instead supports concurrent clients without ownership switching; see [Codex shared sessions](../docs/guide/codex-shared-sessions.md).
- Ordinary wrappers export `HAMLET_SESSION_ID` after bootstrap. Shared Codex uses a per-root MCP bridge and `shell_environment_policy.set.HAMLET_SESSION_ID`; never put one root's ID into the shared app-server environment. Implementation: `src/codex/shared/root.ts`, `src/codex/shared/runtime.ts`.
- Gemini remains a historical wire flavor, not a launchable integration. Use the [supported-agent guide](../docs/guide/agents.md) for the launchable set.

## Storage

Data is stored in `~/.hamlet/` (or `$HAMLET_HOME`):

- `settings.json` - User settings (machineId, token, onboarding flag). See `src/persistence.ts`.
- `runner.state.json` - Runner state (pid, port, version, heartbeat).
- `logs/` - Log files.

## Requirements

- Install and authenticate the agent you want to use. Claude CLI (`claude` on PATH) is required only for `hamlet claude`.
- Cursor Agent CLI installed (`agent` on PATH) for `hamlet cursor`. Install: `curl https://cursor.com/install -fsS | bash` (macOS/Linux), `irm 'https://cursor.com/install?win32=true' | iex` (Windows).
- Grok Build CLI installed (`grok` on PATH) for `hamlet grok`. Authenticate with `grok login --device-auth` on headless runner machines, or set `XAI_API_KEY`.
- OpenCode CLI installed (`opencode` on PATH).
- Bun 1.4.0 for building from source.

## Build from source

From the repo root:

```bash
bun install
bun run build:cli                 # Type-check the CLI; no executable output
bun run --cwd cli build:exe       # Host-platform executable in cli/dist-exe/<target>/
```

For an all-in-one binary that also embeds the web app:

```bash
bun run build:single-exe
```

## Source structure

- `src/api/` - Hub communication (Socket.IO + REST).
- `src/claude/` - Claude Code integration.
- `src/codex/` - Codex mode integration.
- `src/cursor/` - Cursor Agent integration.
- `src/grok/` - Grok Build native TUI + ACP integration.
- `src/agent/` - Shared support for ACP-compatible agents.
- `src/opencode/` - OpenCode ACP + hook integration.
- `src/runner/` - Background service.
- `src/commands/` - CLI command handlers.
- `src/ui/` - User interface and diagnostics.
- `src/modules/` - Tool implementations (ripgrep, difftastic, git).

## Releasing

From the repository root, `bun run release-all <version>` updates the CLI package,
shared app version, iOS `MARKETING_VERSION` (app and notification extension, all
configurations), and Android's default `versionName` before building and publishing.
Use `--dry-run` to preview without changing files or publishing. Native build
numbers (`CURRENT_PROJECT_VERSION` / `versionCode`) remain managed separately;
Android's `-PhamletVersionName` override is preserved.

## Related docs

- `../hub/README.md`
- `../web/README.md`
