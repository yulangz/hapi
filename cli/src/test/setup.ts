import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// This file runs at the top level of each vitest worker, before any test file
// is imported. It reads the hub config written by globalSetup.ts and injects
// the env vars so the CLI configuration singleton sees the temp hub.
const CONFIG_FILE = join(tmpdir(), 'hamlet-test-config.json')

if (!existsSync(CONFIG_FILE)) {
    throw new Error(
        `[test setup] Missing isolated hub config: ${CONFIG_FILE}\n` +
        'Run the full test suite via "pnpm test" so globalSetup can spin up a temp hub first.'
    )
}

let config: { port: number; token: string; tmpHome: string; bunExec: string; stubClaudePath?: string }
try {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
} catch (err) {
    throw new Error(`[test setup] Failed to parse hub config at ${CONFIG_FILE}: ${err}`)
}

process.env.HAMLET_API_URL = `http://127.0.0.1:${config.port}`
process.env.CLI_API_TOKEN = config.token
process.env.HAMLET_HOME = config.tmpHome
process.env.HAMLET_BUN_EXEC = config.bunExec
// The runner agent-availability preflight must see an installable Claude CLI
// even on machines (CI) without one; globalSetup provides a stub binary.
if (config.stubClaudePath) process.env.HAMLET_CLAUDE_PATH = config.stubClaudePath
// The stress test starts 20 real CLI children. On slower/loaded machines their
// session webhooks can take longer than the production control-client default.
process.env.HAMLET_RUNNER_HTTP_TIMEOUT ??= '60000'
// Keep heartbeat short so the version-mismatch test doesn't need to wait 60s
process.env.HAMLET_RUNNER_HEARTBEAT_INTERVAL ??= '30000'
