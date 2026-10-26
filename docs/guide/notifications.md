# Notifications

Get notified when sessions need input, request permissions, fail, or complete — via native app notifications, Telegram, Server酱 (ServerChan), Web Push, or voice.

Web Push needs no provider configuration: [install the PWA](./pwa.md) and allow notifications. The channels below are optional.

## Web Push while HAPI is visible

By default, a visible web client in your namespace receives an in-page toast
instead of a system push notification. To receive both, start the Hub with:

```bash
export HAPI_WEB_PUSH_FOREGROUND=true
hapi hub
```

You can also set `"webPushForeground": true` in the Hub's `settings.json` and
restart the Hub. Environment values override file values and are persisted on
first use. The default remains `false`. This option does not override browser
permissions, operating-system Focus/Do Not Disturb, or native-delivery deduplication.
It applies to ready, permission/input-request, and background-task notifications.
The Hub still needs to reach the push service in each browser's subscription.

## Local system notification fallback

When notification permission is already allowed but the browser has no Web Push
subscription (for example, its push service cannot be reached), an open HAPI page
can display system notifications directly from its live Hub connection. This works
for visible and hidden tabs without minimizing the window. Multiple tabs share
notification receipts so one event produces one local notification per browser
profile. Permission requests, ready-for-input, and task notifications are covered.

This fallback does not request or override permission and stops displaying local
alerts once a Web Push subscription exists. It requires an active service worker,
Web Locks, and local storage. A closed, suspended, sleeping, or disconnected page
cannot receive live events; remote Web Push is still needed in those cases. Focus /
Do Not Disturb can still suppress system banners.

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
export HAPI_PUBLIC_URL="https://your-public-url"

hapi hub
```

Then message your bot with `/start`, open the app, and bind using
`CLI_API_TOKEN:<namespace>` (for example, `your-token:default`).

Related environment variables:

- `TELEGRAM_NOTIFICATION` - Enable/disable Telegram notifications (default: `true`)

**Troubleshooting:**

- If binding fails, verify `HAPI_PUBLIC_URL` is accessible from the internet
- Telegram Mini App requires HTTPS (not HTTP)

## ServerChan (Server酱) Setup

Server酱 pushes notifications to WeChat and other channels. The hub sends ServerChan messages when a session is ready for input, requests a permission, a task fails, or a session completes.

1. Get a SendKey from [sct.ftqq.com](https://sct.ftqq.com/)
2. Set the SendKey and start the hub:

```bash
export SERVERCHAN_SENDKEY="your-sendkey"
export HAPI_PUBLIC_URL="https://your-public-url"

hapi hub
```

Messages include a link back to the session, built from `HAPI_PUBLIC_URL`.

Related environment variables:

- `SERVERCHAN_NOTIFICATION` - Enable/disable ServerChan notifications (default: `true`)
- `SERVERCHAN_BACKGROUND_ONLY` - Only send ServerChan notifications when the namespace has no visible HAPI connection (default: `false`)

When `SERVERCHAN_BACKGROUND_ONLY=true`, a visible HAPI connection suppresses ServerChan for the entire namespace. Hidden, disconnected, or closed HAPI pages do not count as visible, so ServerChan can act as a background fallback. This is namespace-wide and does not select a particular device.

These values can also be set in `settings.json` (`serverChanSendKey`, `serverChanNotification`, `serverChanBackgroundOnly`).

## Voice assistant setup

Enable voice control:

1. Get an API key from [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys)
2. Set the environment variable:

```bash
export ELEVENLABS_API_KEY="your-api-key"
hapi hub --relay
```

See [Voice Assistant](./voice-assistant.md) for usage details.
