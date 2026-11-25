import packageJson from '../../package.json'
import { getCliArgs } from '@/utils/cliArgs'
import { ensureLoopbackProxyBypass } from '@/utils/proxyEnv'
import { printCliHelp } from './help'

export async function runCli(): Promise<void> {
    const args = getCliArgs()

    if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
        printCliHelp()
        return
    }

    if (args[0] === '-v' || args[0] === '--version') {
        console.log(`hamlet version: ${packageJson.version}`)
        return
    }

    if (args.length === 0) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            console.error('Agent selection requires an interactive terminal. Run: hamlet <agent> [options]')
            printCliHelp()
            process.exitCode = 1
            return
        }

        const { selectAgent } = await import('@/ui/selectAgent')
        const selection = await selectAgent()
        if (selection.type === 'exit') {
            process.exitCode = selection.exitCode
            return
        }
        args.push(selection.agent)
    }

    const { resolveCommand } = await import('./registry')
    const resolved = resolveCommand(args)
    if (!resolved) {
        console.error(`Unknown ${args[0].startsWith('-') ? 'option' : 'command'}: ${args[0]}`)
        console.error('Run hamlet to choose an agent, or use hamlet <agent> [options]. See hamlet --help.')
        process.exitCode = 1
        return
    }

    ensureLoopbackProxyBypass()
    const { isBunCompiled } = await import('@/projectPath')
    if (isBunCompiled()) {
        process.env.DEV = 'false'
    }

    const { command, context } = resolved

    if (command.requiresRuntimeAssets) {
        const { ensureRuntimeAssets } = await import('@/runtime/assets')
        await ensureRuntimeAssets()
        const { logger } = await import('@/ui/logger')
        logger.debug('Starting hamlet CLI with args: ', args)
    }

    await command.run(context)
}
