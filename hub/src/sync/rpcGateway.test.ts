import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'
import { RpcGateway, RpcTargetMissingError } from './rpcGateway'

function createGateway(reply?: unknown) {
    const timeouts: number[] = []
    const calls: Array<{ method: string; params: string }> = []
    const socket = {
        timeout(timeoutMs: number) {
            timeouts.push(timeoutMs)
            return {
                async emitWithAck(_event: string, payload: { method: string; params: string }) {
                    calls.push(payload)
                    if (reply !== undefined) return reply
                    if (payload.method.endsWith(':cursor-chat-store-status')) {
                        return JSON.stringify({ onDisk: false, store: null })
                    }
                    return JSON.stringify({
                        success: true,
                        method: payload.method,
                        params: JSON.parse(payload.params) as unknown
                    })
                }
            }
        }
    }

    const io = {
        of() {
            return {
                sockets: {
                    get() {
                        return socket
                    }
                }
            }
        }
    } as unknown as Server

    const rpcRegistry = {
        getSocketIdForMethod() {
            return 'socket-1'
        }
    } as unknown as RpcRegistry

    return {
        gateway: new RpcGateway(io, rpcRegistry),
        timeouts,
        calls
    }
}

describe('RpcGateway RPC timeouts', () => {
    it('allows slow image ACKs without extending ordinary file RPC deadlines', async () => {
        const image = { success: true, content: 'aW1hZ2U=', mimeType: 'image/png' }
        const { gateway, calls, timeouts } = createGateway(JSON.stringify(image))

        expect(await gateway.readGeneratedImage('session-1', 'image-1')).toEqual(image)
        await gateway.readSessionFile('session-1', 'README.md')

        expect(calls[0]).toEqual({
            method: 'session-1:readGeneratedImage',
            params: JSON.stringify({ id: 'image-1' })
        })
        expect(timeouts).toEqual([120_000, 30_000])
    })

    it('uses the default RPC timeout for regular machine RPCs', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listMachineDirectory('machine-1', 'C:\\workspace')

        expect(timeouts).toEqual([30_000])
    })

    it('uses an extended RPC timeout when listing Codex models', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCodexModelsForMachine('machine-1')

        expect(timeouts).toEqual([120_000])
    })

    it('uses the session RPC for explicit Codex fallback discovery', async () => {
        const { gateway, calls, timeouts } = createGateway()

        await gateway.listCodexModelsForSession('session-1')

        expect(calls.map((call) => call.method)).toEqual(['session-1:listCodexModels'])
        expect(timeouts).toEqual([120_000])
    })

    it('uses an extended RPC timeout when listing Cursor models for a machine', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCursorModelsForMachine('machine-1')

        expect(timeouts).toEqual([120_000])
    })

    it('uses an extended RPC timeout when listing Copilot models', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCopilotModelsForCwd('machine-1', '/workspace')
        await gateway.listCopilotModelsForSession('session-1')

        expect(timeouts).toEqual([120_000, 120_000])
    })

    it('forwards the recorded session owner home to the Cursor store probe', async () => {
        const { gateway, calls } = createGateway()

        await gateway.getCursorChatStoreStatus(
            'machine-1',
            '/workspace/project',
            'cursor-session',
            '/home/recorded-owner'
        )

        expect(calls).toEqual([{
            method: 'machine-1:cursor-chat-store-status',
            params: JSON.stringify({
                workspacePath: '/workspace/project',
                cursorSessionId: 'cursor-session',
                homeDir: '/home/recorded-owner'
            })
        }])
    })
})

describe('RpcGateway generated media reads', () => {
    it('shares one pending upload across readers and reuses the immutable result', async () => {
        let resolve!: (value: string) => void
        const reply = new Promise<string>(done => { resolve = done })
        const { gateway, calls } = createGateway(reply)
        const first = gateway.readGeneratedImage('session-1', 'image-1')
        const second = gateway.readGeneratedImage('session-1', 'image-1')
        expect(calls).toHaveLength(1)
        const image = { success: true, content: 'aW1hZ2U=', mimeType: 'image/png' }
        resolve(JSON.stringify(image))
        expect(await Promise.all([first, second])).toEqual([image, image])
        expect(await gateway.readGeneratedImage('session-1', 'image-1')).toEqual(image)
        expect(calls).toHaveLength(1)
        await gateway.readGeneratedImage('session-2', 'image-1')
        expect(calls).toHaveLength(2)
    })

    it('does not cache failures and releases a rejected in-flight request for retry', async () => {
        let reject!: (error: Error) => void
        const reply = new Promise<string>((_resolve, fail) => { reject = fail })
        const { gateway, calls } = createGateway(reply)
        const results = Promise.allSettled([
            gateway.readGeneratedImage('session-1', 'image-1'),
            gateway.readGeneratedImage('session-1', 'image-1')
        ])
        reject(new Error('temporary disconnect'))
        expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected'])
        await expect(gateway.readGeneratedImage('session-1', 'image-1')).rejects.toThrow('temporary disconnect')
        expect(calls).toHaveLength(2)

        const failed = createGateway(JSON.stringify({ success: false, error: 'not found' }))
        await failed.gateway.readGeneratedImage('session-1', 'image-1')
        await failed.gateway.readGeneratedImage('session-1', 'image-1')
        expect(failed.calls).toHaveLength(2)
    })

    it('evicts the least recently used payload when the byte budget is exhausted', async () => {
        const { gateway, calls } = createGateway(JSON.stringify({ success: true, content: 'A'.repeat(5 * 1024 * 1024), mimeType: 'image/png' }))
        await gateway.readGeneratedImage('session-1', 'image-1')
        await gateway.readGeneratedImage('session-1', 'image-2')
        await gateway.readGeneratedImage('session-1', 'image-2')
        expect(calls).toHaveLength(2)
        await gateway.readGeneratedImage('session-1', 'image-1')
        expect(calls).toHaveLength(3)
    })
})

describe('RpcGateway archive acknowledgements', () => {
    it('accepts an explicit successful close acknowledgement', async () => {
        const { gateway } = createGateway(JSON.stringify({ success: true }))
        await expect(gateway.killSession('session-1')).resolves.toBeUndefined()
    })

    it.each([
        JSON.stringify({ error: 'Native thread could not be archived' }),
        { error: 'Native thread could not be archived' }
    ])('propagates CLI handler failures instead of reporting archive success (%j)', async reply => {
        const { gateway } = createGateway(reply)
        const error = await gateway.killSession('session-1').catch(error => error)
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain('Native thread could not be archived')
        expect(error).not.toBeInstanceOf(RpcTargetMissingError)
    })

    it.each([null, {}, { success: false }, 'invalid response'])('rejects a missing or negative acknowledgement (%j)', async reply => {
        const { gateway } = createGateway(reply)
        await expect(gateway.killSession('session-1')).rejects.toThrow('archive')
    })
})

// tiann/hapi#916: rpcCall throws a typed `RpcTargetMissingError` when the
// target CLI is unreachable, so syncEngine.archiveSession can narrow on it
// and treat the kill as a benign no-op.
describe('RpcGateway no-target diagnostics (tiann/hapi#916)', () => {
    it('throws RpcTargetMissingError(handler-not-registered) when no socket is registered for the method', async () => {
        const io = {
            of() {
                return {
                    sockets: {
                        get() { return undefined }
                    }
                }
            }
        } as unknown as Server
        const rpcRegistry = {
            getSocketIdForMethod() { return undefined }
        } as unknown as RpcRegistry
        const gateway = new RpcGateway(io, rpcRegistry)

        const error = await gateway.killSession('session-1').catch((e: unknown) => e)
        expect(error).toBeInstanceOf(RpcTargetMissingError)
        expect((error as RpcTargetMissingError).code).toBe('handler-not-registered')
    })

    it('throws RpcTargetMissingError(socket-disconnected) when the socket id is registered but no socket exists', async () => {
        const io = {
            of() {
                return {
                    sockets: {
                        get() { return undefined }
                    }
                }
            }
        } as unknown as Server
        const rpcRegistry = {
            getSocketIdForMethod() { return 'socket-1' }
        } as unknown as RpcRegistry
        const gateway = new RpcGateway(io, rpcRegistry)

        const error = await gateway.killSession('session-1').catch((e: unknown) => e)
        expect(error).toBeInstanceOf(RpcTargetMissingError)
        expect((error as RpcTargetMissingError).code).toBe('socket-disconnected')
    })
})
