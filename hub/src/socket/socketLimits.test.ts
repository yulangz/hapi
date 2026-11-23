import { describe, expect, it } from 'bun:test'
import { GENERATED_MEDIA_RPC_TIMEOUT_MS, MAX_GENERATED_IMAGE_BYTES, SOCKET_IDLE_TIMEOUT_SECONDS, SOCKET_MAX_HTTP_BUFFER_SIZE, SOCKET_PING_INTERVAL_MS, SOCKET_PING_TIMEOUT_MS } from './socketLimits'

describe('socket limits', () => {
    it('keeps the transport open until a slow media ACK and its queued pong can arrive', () => {
        expect(SOCKET_PING_TIMEOUT_MS).toBeGreaterThanOrEqual(GENERATED_MEDIA_RPC_TIMEOUT_MS)
        expect(SOCKET_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThanOrEqual(
            SOCKET_PING_INTERVAL_MS + SOCKET_PING_TIMEOUT_MS
        )
    })

    it('buffer size can carry the largest generated image after base64 + JSON-RPC framing', () => {
        // Generated images cross the /cli socket as a base64 string inside a JSON-RPC envelope.
        // base64 inflates the payload by ~4/3; the engine default (1e6) silently drops anything
        // above ~750 KB raw (issue #927). The buffer must exceed the largest allowed image.
        const base64Bytes = Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4
        expect(SOCKET_MAX_HTTP_BUFFER_SIZE).toBeGreaterThan(base64Bytes)
        // and must be well above the 1 MB engine default that caused the regression
        expect(SOCKET_MAX_HTTP_BUFFER_SIZE).toBeGreaterThan(1e6)
    })
})
