/**
 * Unified MCP bridge setup for Codex local and remote modes.
 *
 * This module provides a single source of truth for starting the hamlet MCP
 * bridge server and generating the MCP server configuration that Codex needs.
 */

import { startHappyServer } from '@/claude/utils/startHappyServer';
import { getHappyCliCommand } from '@/utils/spawnHappyCLI';
import type { ApiSessionClient } from '@/api/apiSession';
import { exportHamletSessionEnv } from '@/agent/hamletSessionEnv';
import type { CodexMcpServerConfig } from './codexMcpServers';

/**
 * MCP server entry configuration.
 */
export type McpToolApprovalMode = 'auto' | 'prompt' | 'approve';

export interface McpServerToolConfig {
    approval_mode?: McpToolApprovalMode;
}

export interface McpServerEntry extends CodexMcpServerConfig {
    command: string;
    args: string[];
    tools?: Record<string, McpServerToolConfig>;
}

/**
 * Map of MCP server names to their configurations.
 */
export type McpServersConfig = Record<string, McpServerEntry>;

/**
 * Result of starting the hamlet MCP bridge.
 */
export interface HamletMcpBridge {
    /** The running server instance */
    server: {
        url: string;
        stop: () => void;
    };
    /** MCP server config to pass to Codex (works for both CLI and SDK) */
    mcpServers: McpServersConfig;
}

export interface HamletMcpBridgeOptions {
    exportSessionEnv?: boolean;
    emitTitleSummary?: boolean;
    enableChangeTitle?: boolean;
    skillLookup?: {
        workingDirectory: string;
        flavor: string;
    };
}

/**
 * Start the hamlet MCP bridge server and return the configuration
 * needed to connect Codex to it.
 *
 * This is the single source of truth for MCP bridge setup,
 * used by both local and remote launchers.
 *
 * Lazy Codex sessions stay pending until first materialization. We materialize
 * here (before startHappyServer / agent spawn) so:
 * - the hub row exists for REST self-targeting via HAMLET_SESSION_ID
 * - hamletMcpUrl from startHappyServer is persisted to the hub, not only local pending state
 */
export async function buildHamletMcpBridge(
    client: ApiSessionClient,
    options: HamletMcpBridgeOptions = {}
): Promise<HamletMcpBridge> {
    if (client.isPending()) {
        const materialized = await client.materialize();
        if (!materialized) {
            throw new Error(`Failed to materialize HAMLET session ${client.sessionId} before MCP bridge start`);
        }
    }
    // Belt-and-suspenders: onMaterialized already exports; keep env set for non-lazy too.
    if (options.exportSessionEnv !== false) exportHamletSessionEnv(client.sessionId);

    const happyServer = await startHappyServer(client, {
        emitTitleSummary: options.emitTitleSummary,
        enableChangeTitle: options.enableChangeTitle,
        skillLookup: options.skillLookup
    });
    const bridgeCommand = getHappyCliCommand([
        'mcp',
        '--url',
        happyServer.url,
        '--tools',
        happyServer.toolNames.join(',')
    ]);
    const tools: Record<string, McpServerToolConfig> = {
        display_image: {
            approval_mode: 'prompt'
        },
        display_video: {
            approval_mode: 'prompt'
        },
        display_media: {
            approval_mode: 'prompt'
        }
    };
    if (options.enableChangeTitle !== false) {
        tools.change_title = {
            approval_mode: 'approve'
        };
    }
    // Discovery shortlist only - same trust as skill_lookup / change_title.
    tools.list_peers = {
        approval_mode: 'approve'
    };
    // ping_peer / inspect_peer are registered on the HTTP MCP server / stdio
    // bridge, but are not auto-approved: they target another session (resume +
    // inject, or read peer histories).
    if (options.skillLookup) {
        tools.skill_lookup = {
            approval_mode: 'approve'
        };
    }

    return {
        server: {
            url: happyServer.url,
            stop: happyServer.stop
        },
        mcpServers: {
            hamlet: {
                command: bridgeCommand.command,
                args: bridgeCommand.args,
                tools: happyServer.toolNames.includes('whoami')
                    ? Object.fromEntries(happyServer.toolNames.map(name => [name, { approval_mode: 'approve' as const }]))
                    : tools
            }
        }
    };
}
