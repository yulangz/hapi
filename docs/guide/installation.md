# Installation

Install the HAMLET CLI and set up the hub. For phone client builds and pairing,
see [Native apps (iOS / Android)](./native-apps.md); for browser installation,
see [PWA](./pwa.md).

## Prerequisites

- At least one supported agent CLI installed (Claude Code, Codex, Cursor Agent, Grok Build, OpenCode, DeepSeek Harness ACP server, and more — see [Supported Agents](./agents.md))

Verify your CLI is installed:

```bash
# For Claude Code
claude --version

# For OpenAI Codex CLI
codex --version

# For Cursor Agent CLI
agent --version

# For Grok Build CLI
grok --version

# For OpenCode CLI
opencode --version
```

## Architecture

HAMLET uses these runtime roles:

| Component | Role | Required |
|-----------|------|----------|
| **CLI** | Wraps AI coding agents, runs sessions | Yes |
| **Hub** | Central coordinator: persistence, real-time sync, remote access | Yes |
| **Runner** | Background service for remote session spawning | Optional |
| **Client** | Native iOS/Android, Web/PWA or Telegram Mini App | One client for remote control |

### How they work together

The CLI and Runner connect to the hub over Socket.IO; clients send actions
through REST and receive live updates through SSE. The Runner spawns CLI
sessions when requested through the hub. See the [architecture overview](./how-it-works.md#architecture-overview).

- **CLI**: Choose an agent with `hamlet`, or start one directly with `hamlet <agent>`. The CLI wraps your AI agent and syncs with the hub. Scripts must specify the agent explicitly.
- **Hub**: Run `hamlet hub`. Stores sessions, handles permissions, enables remote access.
- **Runner**: Run `hamlet runner start`. Lets you spawn sessions from native or web clients without keeping a terminal open.
- **Client**: Pair a native app with the HTTPS hub origin and access token, or log in through the web app.

### Typical workflows

**Local only**: `hamlet hub` → `hamlet` → work in terminal

**Remote access**: `hamlet hub --relay` → `hamlet runner start` → pair a native app or open the web app

## Install the CLI

```bash
npm install -g @twsxtd/hamlet --registry=https://registry.npmjs.org
```

> Recommendation: use the official npm registry for global install. Some mirrors may not sync platform packages in time.

Or with Homebrew:

```bash
brew install tiann/tap/hamlet
```

## Other install options

<details>
<summary>npx (no install)</summary>

```bash
npx @twsxtd/hamlet
```
</details>

<details>
<summary>Prebuilt binary</summary>

Download the latest release from [GitHub Releases](https://github.com/tiann/hapi/releases).

```bash
xattr -d com.apple.quarantine ./hamlet
chmod +x ./hamlet
sudo mv ./hamlet /usr/local/bin/
```
</details>

<details>
<summary>Build from source</summary>

Requires Bun 1.4.0.

```bash
git clone https://github.com/tiann/hapi.git
cd hamlet
bun install
bun build:single-exe

./cli/dist-exe/<target>/hamlet
```

`<target>` is the Bun build target (e.g., `bun-linux-x64`, `bun-darwin-arm64`); it defaults to the host platform and architecture.
</details>

## Hub setup

The hub can be deployed on:

- **Local desktop** (default) - Run on your development machine
- **Remote host** - Deploy the hub on a VPS, cloud host, or any machine with network access

### Default: Public Relay (recommended)

```bash
hamlet hub --relay
```

The terminal displays a URL and QR code. Scan to access from anywhere.

`hamlet server` remains supported as an alias.

- **End-to-end encrypted** with WireGuard + TLS
- No configuration needed
- Works behind NAT, firewalls, and any network

For relay key management, TCP fallback, and self-hosted tunnel alternatives, see [Deployment](./deployment.md#relay-tunnel-details).

### Local Only

```bash
hamlet hub
# or
hamlet hub --no-relay
```

The hub listens on `http://localhost:3006` by default.

On first run, HAMLET:

1. Creates `~/.hamlet/`
2. Generates a secure access token
3. Prints the token and saves it to `~/.hamlet/settings.json`

<details>
<summary>Config files</summary>

```
~/.hamlet/
├── settings.json      # Main configuration
├── hamlet.db           # SQLite database (hub)
├── runner.state.json  # Runner process state
└── logs/             # Log files
```
</details>

<details>
<summary>Environment variables</summary>

| Variable | Default | settings.json | Description |
|----------|---------|---------------|-------------|
| `CLI_API_TOKEN` | Auto-generated | `cliApiToken` | Shared secret for authentication |
| `HAMLET_API_URL` | `http://localhost:3006` | `apiUrl` | Hub URL for CLI connections |
| `HAMLET_EXTRA_HEADERS_JSON` | - | `extraHeaders` | JSON object of extra outbound headers for CLI → hub HTTP/WebSocket requests |
| `HAMLET_LISTEN_HOST` | `127.0.0.1` | `listenHost` | Hub HTTP bind address |
| `HAMLET_LISTEN_PORT` | `3006` | `listenPort` | Hub HTTP port |
| `HAMLET_PUBLIC_URL` | - | `publicUrl` | Public URL for external access |
| `CORS_ORIGINS` | - | `corsOrigins` | Allowed CORS origins (comma-separated) |
| `TELEGRAM_BOT_TOKEN` | - | `telegramBotToken` | Telegram Bot API token |
| `TELEGRAM_NOTIFICATION` | `true` | `telegramNotification` | Enable Telegram notifications |
| `SERVERCHAN_SENDKEY` | - | `serverChanSendKey` | Server酱 (ServerChan) SendKey for push notifications |
| `SERVERCHAN_NOTIFICATION` | `true` | `serverChanNotification` | Enable ServerChan notifications |
| `SERVERCHAN_BACKGROUND_ONLY` | `false` | `serverChanBackgroundOnly` | Only send ServerChan notifications when no visible HAMLET connection exists in the namespace |
| `HAMLET_RELAY_API` | `relay.hapi.run` | - | Relay API domain for the public relay |
| `HAMLET_RELAY_AUTH` | Per-hub key issued by the relay | `relayAuthKey` | Relay auth key override (set only when an operator provides a key) |
| `HAMLET_RELAY_FORCE_TCP` | `false` | - | Force TCP mode for relay |
| `HAMLET_OFFICIAL_WEB_URL` | `https://app.hapi.run` | - | Official web app origin, added to CORS when the relay is enabled |
| `HAMLET_WEB_PUSH_FOREGROUND` | `false` | `webPushForeground` | Send Web Push alongside foreground in-page notifications; native-delivery deduplication still applies |
| `VAPID_SUBJECT` | `mailto:admin@hapi.run` | - | Web Push contact info |
| `HAMLET_ANDROID_PUSH` | `auto` | `androidPushMode` | Android push: official relay by default, direct FCM when private credentials are configured; also accepts `relay`, `fcm`, `off` |
| `HAMLET_IOS_PUSH` | `relay` | `iosPushMode` | iOS push: `relay`, direct `apns`, or `off` |
| `HAMLET_PUSH_RELAY_URL` | `https://push.hapi.run` | `iosPushRelayUrl` | Shared Android/iOS push relay, independent of the network tunnel |
| `FCM_SERVICE_ACCOUNT_PATH` | - | `fcmServiceAccountPath` | Direct FCM credentials for private builds using the same Firebase project |
| `HAMLET_HOME` | `~/.hamlet` | - | Config directory path |
| `DB_PATH` | `~/.hamlet/hamlet.db` | - | Database file path |
| `HAMLET_EXPERIMENTAL` | - | - | CLI: enable experimental features (`true`/`1`/`yes`) |
| `ELEVENLABS_API_KEY` | - | Settings / env | ElevenLabs API key for voice + dictation |
| `ELEVENLABS_AGENT_ID` | Auto-created | - | Custom ElevenLabs agent ID |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | - | Settings / env | Gemini Live voice assistant |
| `DASHSCOPE_API_KEY` / `QWEN_API_KEY` | - | Settings / env | Qwen Realtime voice assistant |
| `VOICE_BACKEND` | Auto-detected | - | Default assistant backend: `elevenlabs`, `gemini-live`, or `qwen-realtime` |
| `OPENAI_API_KEY` | - | Settings / env | OpenAI API key for dictation (`gpt-transcribe` / `gpt-live-transcribe`) |
| `DEEPGRAM_API_KEY` | - | Settings / env | Deepgram API key for dictation (`nova-3`) |
| `GROQ_API_KEY` | - | Settings / env | Groq API key for dictation (`whisper-large-v3`) |
| `TRANSCRIPTION_BASE_URL` | - | Settings / env | OpenAI-compatible/local transcription base URL |
| `TRANSCRIPTION_MODEL` | - | Settings / env | Model for the OpenAI-compatible transcription endpoint |
| `TRANSCRIPTION_API_KEY` | - | Settings / env | Optional bearer token for that endpoint |
| `HAMLET_TITLE_PROVIDER_BASE_URL` | - | - | Server-only OpenAI-compatible Chat Completions base URL for generated session titles |
| `HAMLET_TITLE_PROVIDER_API_KEY` | - | - | Server-only API key for generated session titles; never sent to the browser |
| `HAMLET_TITLE_PROVIDER_MODEL` | - | - | Server-only lightweight model used for generated session titles |
| `HAMLET_TITLE_SUGGESTION_RATE_LIMIT` | `5` | - | Maximum title suggestions per session in the rate-limit window |
| `HAMLET_TITLE_SUGGESTION_RATE_WINDOW_MS` | `600000` | - | Title suggestion rate-limit window in milliseconds |
| `HAMLET_TITLE_PROVIDER_MAX_TOKENS` | `64` | - | Maximum completion-token budget per generated title; raise for reasoning-model providers |
| `HAMLET_TITLE_PROVIDER_TIMEOUT_MS` | `10000` | - | Title provider request timeout in milliseconds |
</details>

The session rename dialog's **Generate** action is unavailable until all three
`HAMLET_TITLE_PROVIDER_*` variables are configured on the Hub. The provider is
called only on demand; the existing manual rename flow does not require these
variables. Each request sends recent visible user/assistant conversation text
(up to 200 stored messages and a bounded prompt) to that configured provider.

<details>
<summary>settings.json example</summary>

Configuration priority: **ENV > settings.json > default**

When ENV values are set and not present in settings.json, they are automatically saved.
`HAMLET_EXTRA_HEADERS_JSON` is not automatically saved, so access credentials are not persisted unexpectedly.

```json
{
  "$schema": "https://hapi.run/docs/schemas/settings.schema.json",
  "listenHost": "0.0.0.0",
  "listenPort": 3006,
  "publicUrl": "https://your-domain.com",
  "extraHeaders": {
    "Cookie": "CF_Authorization=..."
  }
}
```

JSON Schema: [settings.schema.json](https://hapi.run/docs/schemas/settings.schema.json)
</details>

## CLI setup

If the hub is not on localhost, set these before running `hamlet`:

```bash
export HAMLET_API_URL="http://your-hub:3006"
export CLI_API_TOKEN="your-token-here"
export HAMLET_EXTRA_HEADERS_JSON='{"Cookie":"CF_Authorization=..."}'
```

Or use interactive login:

```bash
hamlet auth login
```

Authentication commands:

```bash
hamlet auth status
hamlet auth login
hamlet auth logout
```

Each machine gets a unique ID stored in `~/.hamlet/settings.json`. This allows:

- Multiple machines to connect to one hub
- Remote session spawning on specific machines
- Machine health monitoring

### Diagnostics

Run `hamlet doctor` for a full diagnostics report: configuration, runner status, logs, and relevant environment info.

```bash
hamlet doctor          # Diagnostics report
hamlet doctor clean    # Kill runaway hamlet processes
```

## Runner setup

Run a background service for remote session spawning:

```bash
hamlet runner start
hamlet runner status
hamlet runner logs
hamlet runner stop
```

With the runner running:

- Your machine appears in the "Machines" list
- You can spawn sessions remotely from the web app
- Sessions persist even when the terminal is closed

#### Split hub + remote runner (peer discovery)

When the hub runs on one host and the runner on another, agents inside runner-spawned sessions should discover peers via MCP **`list_peers`** (same hub credentials as the session CLI). Prefer that over shelling `hamlet ping-peer --list`.

```
[Hub host]  hamlet hub          ← sessions DB + /api/sessions
     ▲
     │ HAMLET_API_URL + CLI_API_TOKEN
     │
[Runner host]  hamlet runner start  → spawns session CLIs
                     │
                     ▼
              agent session  → MCP list_peers / inspect_peer / ping_peer
```

On the runner host, configure the **same** hub URL and token the hub uses:

```bash
export HAMLET_API_URL="http://your-hub:3006"   # or Tailscale / public URL
export CLI_API_TOKEN="your-token-here"
# or: hamlet auth login   # saves the token; still set HAMLET_API_URL for a remote hub
hamlet runner start
```

Session CLI may export an **explicit** non-default `HAMLET_API_URL` (from env or settings) into child env so shell helpers hit the same remote hub. It does **not** mirror `CLI_API_TOKEN` into wrapped agents (settings/prompt-backed secrets stay out of agent env; a fresh `hamlet` re-reads `~/.hamlet/settings.json`, and systemd/env tokens already inherit). Prefer MCP `list_peers` inside a session. Web terminal PTYs still strip hub secrets. If `--list` fails with an auth/URL error, the message points at `hamlet auth login` and the configured hub URL.

Additional runner commands:

```bash
hamlet runner list                      # List active sessions
hamlet runner stop-session <sessionId>  # Stop a single session managed by the runner
```

Use `--workspace-root <path>` to restrict which directories the runner can browse and spawn sessions in. Repeat the flag to allow multiple directories; supports `~` expansion:

```bash
hamlet runner start --workspace-root ~/projects --workspace-root ~/work
```

Without `--workspace-root`, directory browsing and spawning both accept paths
anywhere the runner's OS account can access. The iOS directory picker starts
at the home directory and can navigate above it. Configuring roots restricts
both browsing and spawning to those roots, including symlink targets.

For running the hub and runner as persistent background services (pm2, launchd, systemd), see [Deployment](./deployment.md). Supervised installs should set `HAMLET_RUNNER_SUPERVISED=1` on the runner process (systemd `Environment=` / pm2 `--env`) so the web **Restart** control can safely stop-runner knowing the supervisor will cold-start it.

### Multi-machine hubs

You can run **one hub** and **runners on many machines** (each machine installs its own CLI). When you upgrade the hub, upgrade the HAMLET CLI on every machine that parents sessions. After the CLI binary on disk changes, that machine’s runner normally **self-restarts** via version handoff (unless `HAMLET_DISABLE_VERSION_HANDOFF=1`). Until a runner reports the capabilities the hub requires, the web UI shows a **Runner out of date** banner (minimizable / snoozeable) with the host name and upgrade steps. The banner’s per-host **Restart** is only an escape hatch when handoff is stuck or disabled — the hub never downloads or installs packages on remotes.

## Security notes

- Keep tokens secret and rotate if needed
- Use HTTPS for public access
- Restrict CORS origins in production

<details>
<summary>Firewall example (ufw)</summary>

```bash
ufw allow from 192.168.1.0/24 to any port 3006
```
</details>
