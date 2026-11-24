import { CREATABLE_AGENT_FLAVORS, getFlavorLabel } from '@hamlet/protocol'

export function printCliHelp(): void {
    const agents = [...CREATABLE_AGENT_FLAVORS].sort().map((agent) => (
        `  ${`hamlet ${agent}`.padEnd(26)} ${getFlavorLabel(agent)}`
    )).join('\n')

    console.log(`HAMLET - Coding agents with remote control

Usage:
  hamlet                       Choose an agent interactively
  hamlet <agent> [options]      Start an agent session
  hamlet <command> [options]    Run a HAMLET command

Agents:
${agents}

Commands:
  hamlet auth                  Manage authentication
  hamlet resume [id]           Choose or resume an existing HAMLET session
  hamlet hub [--relay]         Start the API + web hub
  hamlet server                Alias for hamlet hub
  hamlet runner                Manage the background runner
  hamlet doctor                Run diagnostics and troubleshooting
  hamlet ping-peer             List peers or message another session
  hamlet inspect-peer <id>     Read another session's metadata and messages
  hamlet mcp                   Start the MCP stdio bridge

Options:
  -h, --help                 Show HAMLET help
  -v, --version              Show HAMLET version

Examples:
  hamlet                       Choose an installed agent
  hamlet claude --resume       Resume a Claude session
  hamlet codex --yolo          Start Codex with automatic approvals
  hamlet auth login            Configure authentication

Agent options belong after the agent name; supported options vary by agent.
Scripts and non-interactive shells must specify an agent explicitly.`)
}
