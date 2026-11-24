import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configuration } from '@/configuration'
import { buildFilteredEnv, resolveShellCommand } from '@/terminal/TerminalManager'
import { doorbellSdk, supervisor } from './scripts'

export async function machineExec({ command, cwd }: { command: string; cwd?: string }) {
    const [shell, ...args] = resolveShellCommand()
    const flags =
        process.platform !== 'win32' ? ['-c'] : shell.toLowerCase().endsWith('cmd.exe') ? ['/c'] : ['-Command']
    try {
        const output = await promisify(execFile)(shell, [...args, ...flags, command], {
            cwd,
            env: buildFilteredEnv(),
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
        })
        return { ...output, exit_code: 0 }
    } catch (err) {
        const e = err as Error & { stdout?: string; stderr?: string; code?: number | string; signal?: string }
        return { stdout: e.stdout, stderr: e.stderr, error: e.message, exit_code: e.code, signal: e.signal }
    }
}

type Bell = { id: string; owner: string; name: string; directory: string; script: string; token: string }
type Monitor = { directory: string; child?: ChildProcess; failures: number; retryAt: number; error: string | null }
export class Doorbells {
    private monitors = new Map<string, Monitor>()
    private closed = false
    private tail = Promise.resolve()
    private revision?: string
    private bells: Bell[] = []

    reconcile({ revision, bells }: { revision: string; bells?: Bell[] }) {
        const work = this.tail.then(() => {
            if (this.closed) return []
            if (bells) {
                this.revision = revision
                this.bells = bells
            }
            if (this.revision !== revision) return null
            return this.apply(this.bells)
        })
        this.tail = work.then(
            () => {},
            () => {},
        )
        return work
    }
    private async apply(bells: Bell[]) {
        const wanted = new Map(bells.map((b) => [b.id, b.directory]))
        const stopping: Promise<void>[] = []
        for (const [id, m] of this.monitors) {
            if (wanted.get(id) !== m.directory) {
                if (m.child) {
                    const child = m.child
                    stopping.push(new Promise((resolve) => child.once('close', () => resolve())))
                    child.stdin?.end()
                }
                this.monitors.delete(id)
            }
        }
        await Promise.all(stopping)
        for (const bell of bells) {
            if (this.closed) break
            let m = this.monitors.get(bell.id)
            if (!m) {
                m = { directory: bell.directory, failures: 0, retryAt: 0, error: null }
                this.monitors.set(bell.id, m)
            }
            if (!m.child && Date.now() >= m.retryAt) {
                try {
                    await this.start(bell, m)
                } catch (e) {
                    this.failed(m, String(e))
                }
            }
        }
        return [...this.monitors].map(([id, m]) => ({ id, status: m.child ? 'running' : 'backoff', error: m.error }))
    }
    private failed(m: Monitor, error: string) {
        m.child = undefined
        m.error = error
        m.retryAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(m.failures++, 6))
    }
    private async start(b: Bell, m: Monitor) {
        const dir = join(configuration.happyHomeDir, 'hamlet-doorbells', b.id)
        await mkdir(join(dir, 'state'), { recursive: true, mode: 0o700 })
        const script = join(dir, 'monitor')
        await Promise.all([
            writeFile(script, b.script.replace(/^#!\/usr\/bin\/env doorbell-python/, '#!/usr/bin/env python3'), {
                mode: 0o700,
            }),
            writeFile(join(dir, 'doorbell.py'), doorbellSdk),
        ])
        if (this.closed) return
        const interpreter = process.platform === 'win32' ? 'python' : 'python3'
        const child = spawn(interpreter, ['-u', '-c', supervisor, script, join(dir, 'output.log')], {
            cwd: b.directory,
            stdio: ['pipe', 'ignore', 'ignore'],
            env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                PYTHONPATH: dir,
                DOORBELL_AGENT_ID: b.owner,
                DOORBELL_TOKEN: b.token,
                DOORBELL_STATE_DIR: join(dir, 'state'),
                DOORBELL_URL: configuration.apiUrl + '/hamlet/ring',
            },
        })
        m.child = child
        m.error = null
        const started = Date.now()
        const ended = (why: string) => {
            if (m.child !== child) return
            if (Date.now() - started > 60_000) m.failures = 0
            this.failed(m, why)
        }
        child.on('error', (e) => ended(e.message))
        child.on('exit', (code, signal) => ended('Monitor exited: ' + (signal ?? code)))
    }
    async log(id: string) {
        const file = await open(join(configuration.happyHomeDir, 'hamlet-doorbells', id, 'output.log'), 'r')
        try {
            const { size } = await file.stat()
            const bytes = Buffer.alloc(Math.min(size, 64 * 1024))
            await file.read(bytes, 0, bytes.length, size - bytes.length)
            return { log: bytes.toString('utf8') }
        } finally {
            await file.close()
        }
    }
    close() {
        this.closed = true
        for (const m of this.monitors.values()) m.child?.stdin?.end()
        this.monitors.clear()
    }
}
