import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSessionClient } from '@/api/apiSession'
import { HAMLET_SESSION_ID_ENV } from '@/agent/hamletSessionEnv'

const harness = vi.hoisted(() => ({
    startOptions: null as unknown,
    cliArgs: [] as string[],
    materialize: vi.fn(async () => true)
}))

vi.mock('@/claude/utils/startHappyServer', () => ({
    startHappyServer: vi.fn(async (_client: unknown, options: { skillLookup?: unknown }) => {
        harness.startOptions = options
        return {
            url: 'http://127.0.0.1:43006/',
            toolNames: options.skillLookup
                ? ['change_title', 'display_image', 'display_video', 'display_media', 'list_peers', 'ping_peer', 'inspect_peer', 'skill_lookup']
                : ['change_title', 'display_image', 'display_video', 'display_media', 'list_peers', 'ping_peer', 'inspect_peer'],
            stop: vi.fn()
        }
    })
}))

vi.mock('@/utils/spawnHappyCLI', () => ({
    getHappyCliCommand: vi.fn((args: string[]) => {
        harness.cliArgs = args
        return { command: 'hamlet', args }
    })
}))

import { buildHamletMcpBridge } from './buildHamletMcpBridge'

function createClient(options?: { pending?: boolean; sessionId?: string }): ApiSessionClient {
    let pending = options?.pending ?? false
    return {
        sessionId: options?.sessionId ?? 'hub-session-1',
        isPending: () => pending,
        materialize: async () => {
            const ok = await harness.materialize()
            if (ok) {
                pending = false
            }
            return ok
        }
    } as unknown as ApiSessionClient
}

describe('buildHamletMcpBridge skill lookup config', () => {
    beforeEach(() => {
        harness.startOptions = null
        harness.cliArgs = []
        harness.materialize.mockReset()
        harness.materialize.mockResolvedValue(true)
        delete process.env[HAMLET_SESSION_ID_ENV]
    })

    it('forwards the enabled HTTP tool through STDIO and auto-approves it', async () => {
        const skillLookup = {
            workingDirectory: '/repo',
            flavor: 'opencode'
        }

        const bridge = await buildHamletMcpBridge(createClient(), { skillLookup })

        expect(harness.startOptions).toEqual({
            emitTitleSummary: undefined,
            skillLookup
        })
        expect(harness.cliArgs).toEqual([
            'mcp',
            '--url',
            'http://127.0.0.1:43006/',
            '--tools',
            'change_title,display_image,display_video,display_media,list_peers,ping_peer,inspect_peer,skill_lookup'
        ])
        expect(bridge.mcpServers.hamlet.tools).toEqual({
            change_title: { approval_mode: 'approve' },
            display_image: { approval_mode: 'prompt' },
            display_video: { approval_mode: 'prompt' },
            display_media: { approval_mode: 'prompt' },
            list_peers: { approval_mode: 'approve' },
            skill_lookup: { approval_mode: 'approve' }
        })
    })

    it('does not expose skill_lookup for native-skill bridge callers', async () => {
        const bridge = await buildHamletMcpBridge(createClient())

        expect(harness.cliArgs.at(-1)).toBe('change_title,display_image,display_video,display_media,list_peers,ping_peer,inspect_peer')
        expect(bridge.mcpServers.hamlet.tools).toEqual({
            change_title: { approval_mode: 'approve' },
            display_image: { approval_mode: 'prompt' },
            display_video: { approval_mode: 'prompt' },
            display_media: { approval_mode: 'prompt' },
            list_peers: { approval_mode: 'approve' }
        })
    })

    it('materializes pending lazy sessions before starting the MCP server', async () => {
        const client = createClient({ pending: true, sessionId: 'lazy-session-1' })

        await buildHamletMcpBridge(client)

        expect(harness.materialize).toHaveBeenCalledOnce()
        expect(process.env[HAMLET_SESSION_ID_ENV]).toBe('lazy-session-1')
        expect(client.isPending()).toBe(false)
    })

    it('fails closed when pending materialization fails', async () => {
        harness.materialize.mockResolvedValue(false)
        const client = createClient({ pending: true, sessionId: 'lazy-session-fail' })

        await expect(buildHamletMcpBridge(client)).rejects.toThrow(
            'Failed to materialize HAMLET session lazy-session-fail before MCP bridge start'
        )
        expect(process.env[HAMLET_SESSION_ID_ENV]).toBeUndefined()
    })
})
