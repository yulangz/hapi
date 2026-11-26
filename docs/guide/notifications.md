# Notifications

Get notified when sessions need input, request permissions, fail, or complete — via native app notifications, Telegram, Server酱 (ServerChan), Web Push, or voice.

Web Push needs no provider configuration: [install the PWA](./pwa.md) and allow notifications. The channels below are optional.

## Main Agent browser notifications

Enable browser notifications in Settings → General. HAMLET sends a generic
system alert for each new main Agent reply to every registered browser endpoint,
even when another browser has the page open. A shared browser endpoint belongs
to the account that last registered it. The alert opens HAMLET, where your
current sign-in determines which replies you can read.

For Codex sessions with an active Goal, intermediate turn completions do not
produce ready-for-input notifications: the Goal is still running automatically.
Ready notifications resume after the Goal completes, pauses, becomes blocked, or
reaches a budget/usage limit. Permission and user-input requests are unaffected.

## Local system notification fallback

When notification permission is granted, an open HAMLET page can display a
local alert from its live connection if the push service did not confirm
acceptance of that reply for the browser's endpoint. This works in visible and
hidden tabs and while viewing a different session. Tabs and the service worker
share a browser receipt for each reply, including after the alert is dismissed.

HAMLET uses the service worker for local alerts when available. An open page
can also show them directly if its browser supports page notifications.
When the page is closed or disconnected, delivery requires Web Push. The Hub
must be able to reach the browser's push service. Operating-system Focus or Do
Not Disturb can suppress system banners.

## Native app notifications

See [Native apps](./native-apps.md) for build, pairing and platform requirements.

For official Android and iOS apps, pair an updated hub and allow notifications.
No Firebase project or Apple developer account is needed. Notification content
is end-to-end encrypted through the official push relay, which also works when
you access the hub through Tailscale or your own HTTPS setup. Android requires
Google Play services and FCM connectivity.

Private app builds need matching Firebase/APNs credentials. An Android build
without Firebase configuration has no FCM push. For a self-signed iOS build,
the signing account, bundle ID and APNs environment must match the provider
configuration; the official relay cannot deliver to an arbitrary self-build.
See the [native push contract](../api/native-companion-contract.md) for settings
and delivery details. This push relay is independent of the `--relay` network
tunnel.

## Telegram Setup

Enable Telegram notifications and Mini App access:

1. Message [@BotFather](https://t.me/BotFather) and create a bot
2. Set the bot token and public URL
3. Start the hub and bind your account

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export HAMLET_PUBLIC_URL="https://your-public-url"

hamlet hub
```

Then message your bot with `/start`, open the app, and bind using
`CLI_API_TOKEN:<namespace>` (for example, `your-token:default`).

Related environment variables:

- `TELEGRAM_NOTIFICATION` - Enable/disable Telegram notifications (default: `true`)

**Troubleshooting:**

- If binding fails, verify `HAMLET_PUBLIC_URL` is accessible from the internet
- Telegram Mini App requires HTTPS (not HTTP)

## ServerChan (Server酱) Setup

Server酱 pushes notifications to WeChat and other channels. The hub sends ServerChan messages when a session is ready for input, requests a permission, a task fails, or a session completes.

1. Get a SendKey from [sct.ftqq.com](https://sct.ftqq.com/)
2. Set the SendKey and start the hub:

```bash
export SERVERCHAN_SENDKEY="your-sendkey"
export HAMLET_PUBLIC_URL="https://your-public-url"

hamlet hub
```

Messages include a link back to the session, built from `HAMLET_PUBLIC_URL`.

Related environment variables:

- `SERVERCHAN_NOTIFICATION` - Enable/disable ServerChan notifications (default: `true`)
- `SERVERCHAN_BACKGROUND_ONLY` - Only send ServerChan notifications when the namespace has no visible HAMLET connection (default: `false`)

When `SERVERCHAN_BACKGROUND_ONLY=true`, a visible HAMLET connection suppresses ServerChan for the entire namespace. Hidden, disconnected, or closed HAMLET pages do not count as visible, so ServerChan can act as a background fallback. This is namespace-wide and does not select a particular device.

These values can also be set in `settings.json` (`serverChanSendKey`, `serverChanNotification`, `serverChanBackgroundOnly`).

## Voice assistant setup

Enable voice control:

1. Get an API key from [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys)
2. Set the environment variable:

```bash
export ELEVENLABS_API_KEY="your-api-key"
hamlet hub --relay
```

See [Voice Assistant](./voice-assistant.md) for usage details.
