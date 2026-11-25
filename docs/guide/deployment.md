# Deployment

Run the hub and runner as persistent background services, and configure remote access tunnels.

[Native iOS / Android apps](./native-apps.md#pair-with-your-hub) connect to the
same hub as the web app. Provide an HTTPS hub origin for pairing; Android
rejects cleartext URLs. The push relay used for native notifications is a
separate service from the network tunnels described here.

## Relay tunnel details

The default public relay (`hamlet hub --relay`) works out of the box. This section covers how relay authentication works and how to tune it.

The hub automatically stores an individually revocable relay key in `settings.json` (`relayAuthKey`). If that persisted key is revoked or the relay rotates its signing secret, HAMLET discards it after HTTP 403, requests one replacement, and restarts the tunnel. Relay issuance is limited per public IP; HTTP 429 is reported explicitly, which can affect users sharing a CGNAT or corporate egress address. Set `HAMLET_RELAY_AUTH` only when an operator has provided a key manually; rejected environment keys are never overwritten automatically.

> **Tip:** The relay uses UDP by default. If you experience connectivity issues, set `HAMLET_RELAY_FORCE_TCP=true` to force TCP mode.

Other relay-related environment variables:

- `HAMLET_RELAY_API` - Relay API domain (default: `relay.hapi.run`)
- `HAMLET_OFFICIAL_WEB_URL` - Official web app origin allowed via CORS when the relay is enabled (default: `https://app.hapi.run`)

## Self-hosted tunnels

If you prefer not to use the public relay (e.g., for lower latency or self-managed infrastructure), you can use these alternatives:

<details>
<summary>Cloudflare Tunnel</summary>

https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

> **Note:** Cloudflare Quick Tunnels (TryCloudflare) are not supported because they [do not support SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), which HAMLET uses for real-time updates. Use a Named Tunnel instead.

**Named tunnel setup:**

```bash
# Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Create and configure a named tunnel
cloudflared tunnel create hamlet
cloudflared tunnel route dns hamlet hamlet.yourdomain.com

# Run the tunnel
cloudflared tunnel --protocol http2 run hamlet
```

> **Tip:** Use `--protocol http2` instead of QUIC (the default) to avoid potential timeout issues with long-lived connections.

</details>

<details>
<summary>Tailscale</summary>

https://tailscale.com/download

```bash
sudo tailscale up
```

The default hub listens only on loopback. For browser access directly via
your Tailscale IP, start it with:

```bash
HAMLET_LISTEN_HOST=0.0.0.0 hamlet hub
```

Restrict inbound access to the trusted network with your firewall, then open:

```
http://100.x.x.x:3006
```

For native apps and HTTPS-only browser features, use an HTTPS endpoint
(for example, Tailscale Serve forwarding to the loopback hub) instead.
</details>

<details>
<summary>Public IP / Reverse Proxy</summary>

Keep the hub on its default `127.0.0.1:3006` and put an HTTPS reverse proxy
(Nginx, Caddy, etc.) in front of it. A public IP alone does not make the
loopback listener remotely accessible. Set `HAMLET_LISTEN_HOST` only when you
need another bind address, and restrict direct access with your firewall.

**Self-signed certificates (HTTPS)**

If `HAMLET_API_URL` is set to an `https://...` URL with a self-signed (or otherwise untrusted) certificate, the CLI may fail with:

```
Error: self signed certificate
```

Recommended fixes (in order):

1. Use a publicly trusted certificate (e.g., Let's Encrypt)
2. Trust your private CA (recommended for private networks)
3. Dev-only workaround: disable TLS verification (insecure)

```bash
# Preferred: trust your own CA
export NODE_EXTRA_CA_CERTS="/path/to/your-ca.pem"

# Dev-only workaround: disable TLS verification (INSECURE)
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

If you use the dev-only workaround, assume MITM risk; do not use on public networks.

</details>

## Background service deployment

Keep HAMLET running persistently so it survives terminal closes, system restarts, and continues running in the background.

<details>
<summary>Quick: nohup</summary>

Simple one-liner for quick background runs:

```bash
# Hub
mkdir -p ~/.hamlet/logs
nohup hamlet hub --relay > ~/.hamlet/logs/hub.log 2>&1 &

# Runner
nohup hamlet runner start-sync > ~/.hamlet/logs/runner.log 2>&1 &
```

View logs:

```bash
tail -f ~/.hamlet/logs/hub.log
tail -f ~/.hamlet/logs/runner.log
```

Stop processes:

```bash
pkill -f "hamlet hub"
pkill -f "hamlet runner"
```
</details>

<details>
<summary>pm2 (recommended for Node.js users)</summary>

pm2 provides process management with auto-restart on crashes and system reboot.

```bash
# Install pm2
npm install -g pm2

# Start hub and runner
pm2 start "hamlet hub --relay" --name hamlet-hub
# HAMLET_RUNNER_SUPERVISED=1 lets the web Restart button stop the runner knowing
# pm2 will cold-start it again (unsupervised stop would leave the host offline).
HAMLET_RUNNER_SUPERVISED=1 pm2 start "hamlet runner start-sync" --name hamlet-runner

# View status and logs
pm2 status
pm2 logs hamlet-hub
pm2 logs hamlet-runner

# Auto-restart on system reboot
pm2 startup    # Follow the printed instructions
pm2 save       # Save current process list
```
</details>

<details>
<summary>macOS: launchd</summary>

Create plist files for automatic startup on macOS.

**Hub** (`~/Library/LaunchAgents/com.hamlet.hub.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hamlet.hub</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/hamlet</string>
        <string>hub</string>
        <string>--relay</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.hamlet/logs/hub.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.hamlet/logs/hub.log</string>
</dict>
</plist>
```

**Runner** (`~/Library/LaunchAgents/com.hamlet.runner.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hamlet.runner</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/hamlet</string>
        <string>runner</string>
        <string>start-sync</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HAMLET_RUNNER_SUPERVISED</key>
        <string>1</string>
    </dict>
    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>65536</integer>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/.hamlet/logs/runner.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/.hamlet/logs/runner.log</string>
</dict>
</plist>
```

Load/unload services:

```bash
# Load (start)
launchctl load ~/Library/LaunchAgents/com.hamlet.hub.plist
launchctl load ~/Library/LaunchAgents/com.hamlet.runner.plist

# Unload (stop)
launchctl unload ~/Library/LaunchAgents/com.hamlet.hub.plist
launchctl unload ~/Library/LaunchAgents/com.hamlet.runner.plist
```

> **macOS sleep note:** macOS may suspend background processes when the display sleeps. Use `caffeinate` to prevent this:
> ```bash
> caffeinate -dimsu hamlet hub --relay
> ```
> Or run `caffeinate -dimsu` in a separate terminal while HAMLET is running.
</details>

<details>
<summary>Linux: systemd</summary>

Create user-level systemd services for automatic startup.

**Hub** (`~/.config/systemd/user/hamlet-hub.service`):

```ini
[Unit]
Description=HAMLET Hub
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/hamlet hub --relay
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

**Runner** (`~/.config/systemd/user/hamlet-runner.service`):

```ini
[Unit]
Description=HAMLET Runner
After=network.target hamlet-hub.service

[Service]
Type=simple
KillMode=process
# Advertise supervisedRestart so the web UI Restart button may stop-runner
# knowing systemd will cold-start the unit again.
Environment=HAMLET_RUNNER_SUPERVISED=1
ExecStart=/usr/local/bin/hamlet runner start-sync
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

> **Why `KillMode=process`?** Agent sessions are detached from the runner. The default `KillMode=control-group` would terminate them when the runner service stops; `KillMode=process` preserves them during runner restarts and upgrades. It does not keep processes running through an operating-system shutdown or sleep.

Enable and start:

```bash
# Reload systemd
systemctl --user daemon-reload

# Enable (auto-start on login)
systemctl --user enable hamlet-hub
systemctl --user enable hamlet-runner

# Start now
systemctl --user start hamlet-hub
systemctl --user start hamlet-runner

# View status/logs
systemctl --user status hamlet-hub
journalctl --user -u hamlet-hub -f
```

> **Persist after logout:** To keep services running even when not logged in:
> ```bash
> loginctl enable-linger $USER
> ```
</details>
