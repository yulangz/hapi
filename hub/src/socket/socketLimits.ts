// The largest generated image the CLI will serve inline. Must stay in sync with the CLI-side
// limits in cli/src/claude/utils/startHappyServer.ts and cli/src/modules/common/generatedImages.ts.
export const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024

// Generated images (and other large RPC payloads) cross the /cli socket as a base64 string wrapped
// in a JSON-RPC envelope, which inflates the payload by ~4/3. The engine.io default of 1e6 bytes
// silently drops the CLI -> hub ack frame for any image above ~750 KB raw, so a 25 MB image that
// the MCP tool happily accepts can never reach the browser (issue #927). Size the buffer to carry
// the largest allowed image after base64 + framing, with headroom.
export const SOCKET_MAX_HTTP_BUFFER_SIZE = 48 * 1024 * 1024

// An image ACK can occupy the transport for more than the default 20-second
// heartbeat deadline on a lossy uplink. Pongs cannot overtake a WebSocket
// message already being sent. Keep the connection alive for the media RPC's
// full deadline; otherwise increasing only the RPC timeout cannot help.
export const GENERATED_MEDIA_RPC_TIMEOUT_MS = 120_000
export const SOCKET_PING_INTERVAL_MS = 25_000
export const SOCKET_PING_TIMEOUT_MS = GENERATED_MEDIA_RPC_TIMEOUT_MS
export const SOCKET_IDLE_TIMEOUT_SECONDS = Math.ceil(
    (SOCKET_PING_INTERVAL_MS + SOCKET_PING_TIMEOUT_MS) / 1000
)
