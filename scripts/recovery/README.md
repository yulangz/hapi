# Recovery changes for HAPI v0.30.7

This recovery branch starts at upstream `v0.30.7` (`0239edf3`). The CLI changes
match the source used for the deployed history-scan build. The foreground Web
Push option is a new Hub feature and requires installing an updated Hub.

## CLI changes

- Pace historical Codex items using `HAPI_CODEX_HISTORY_ITEM_DELAY_MS`
  (milliseconds, default `0`, maximum `1000`). Stable message IDs are retained;
  `20` limits replay bursts.
- Send session keep-alives during cold binding, before history replay finishes.
  Restored input still waits for applied settings.
- Register with the Runner before lengthy history binding so it can track the
  session while it is being restored.
- Use asynchronous bounded metadata reads for the history picker. Full
  transcripts are read only for explicitly selected native session IDs.
  Workspace policies and subagent filtering remain in effect.

The corresponding source is in `cli/src/codex/shared/{projection,root,runtime}.ts`,
`cli/src/modules/common/codexSessions.ts`, and `cli/src/api/apiMachine.ts`.
These changes preserve authentication, permissions, and namespace isolation.

## Build

Use the repository's Bun version (`1.4.0`). Invoke that binary directly so a
nested shell does not accidentally select a different Bun from `PATH`:

```bash
bun install --frozen-lockfile
bun run download:tunwg
cd cli
/path/to/bun-1.4.0 scripts/build-executable.ts --target bun-linux-x64-baseline
```

For a single executable containing the web UI, use the root
`build:single-exe` workflow. A CLI-only build without embedded web assets does
not replace a Hub deployment serving its UI from the executable.

In existing recovery deployments, retain `HAPI_DISABLE_VERSION_HANDOFF=1` and
set `HAPI_CLI_EXECUTABLE` to the installed recovery binary. Restarting a Runner
alone does not replace already-running session-owner processes. Restore those
sessions after their current turns finish, preserving native rollout history.

## Optional Linux process helper

`hapi-fast-proc.py` handles HAPI's narrow `ps` and `pgrep` forms without scanning
the entire host process table. Other forms delegate to `/usr/bin/ps` or
`/usr/bin/pgrep`. Use symlinks named `ps` and `pgrep` in a private Runner `PATH`;
do not replace system executables.

## Optional verified-TLS proxy bridge

`hapi_proxy_bridge.py` forwards loopback HTTP/WebSocket traffic through HTTP
CONNECT or SOCKS5h to an HTTPS Hub. It trusts system roots and can add a private
CA using `--ca`. SOCKS5h sends target hostnames to the proxy. Relay directions
run independently, so reverse traffic continues during upload backpressure.

```bash
python3 scripts/recovery/hapi_proxy_bridge.py \
  --hub https://your-hub.example:21759 \
  --proxy socks5h://127.0.0.1:1082 \
  --listen-port 3007
```

Set the Runner's `HAPI_API_URL` to `http://127.0.0.1:3007`. The bridge's `--proxy`
is independent of Codex's model-provider `HTTP_PROXY` and `HTTPS_PROXY`. The
bridge can use SOCKS5h port `1082` while Codex uses an HTTP proxy on port `1081`.
The bridge requires Python 3.6+ and no third-party Python packages.

Run `python3 scripts/recovery/test_hapi_proxy_bridge.py` to check fragmented
proxy handshakes, verified TLS, bidirectional backpressure, and idle connections.
The test requires Python 3.8+ and an OpenSSL command supporting `-addext`; it
uses only loopback servers and a temporary certificate.

## Hub HTTP timeout workaround

`hub-http-timeout.ts` preserves the 180-second HTTP timeout from the existing
v0.30.7 recovery deployment, accommodating the 120-second machine RPC deadline:

```bash
BUN_OPTIONS="--smol --preload /absolute/path/hub-http-timeout.ts" hapi hub
```

This changes Bun's HTTP idle timeout, not Socket.IO liveness thresholds. It was
previously installed separately from the official Hub binary. It does not
implement the new foreground notification feature.

## Foreground system notifications

On an updated Hub, enable `HAPI_WEB_PUSH_FOREGROUND=true`, or set
`"webPushForeground": true` in its `settings.json` and restart the Hub.
The setting defaults to `false` and retains native-provider deduplication.
Browser/OS permissions and access to each subscribed push service remain
required; macOS Focus/Do Not Disturb can suppress delivered notifications.

These recovery sources contain no login tokens, private certificates, machine
configuration files, or binary archives.
