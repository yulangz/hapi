import { Hono } from 'hono'
import { detectImageMimeType } from '@hamlet/protocol'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hamletTools, mainAgentPrompt, AgentConfig, type HamletTool } from '@hamlet/protocol/hamlet'
import { getConfiguration } from '../configuration'
import { readSettings } from '../config/settings'
import type { SyncEngine } from '../sync/syncEngine'
import type { WebAppEnv } from '../web/middleware/auth'
import type { Agent } from './store'

export function hamletOwnerRoutes(get: () => SyncEngine | null) {
    const app = new Hono<WebAppEnv>()
    app.onError((e, c) => c.json({ error: e.message }, 400))
    return app.post('/hamlet/main', async (c) => {
        const hub = get()
        if (!hub) return c.json({ error: 'Hub unavailable' }, 503)
        const config = getConfiguration()
        const machine = (await readSettings(config.settingsFile))?.machineId
        if (!machine || !hub.getMachineByNamespace(machine, c.get('namespace'))?.active)
            return c.json({ error: 'Start Hamlet Runner on the Hub machine first' }, 409)
        const input = z
            .object({
                model: z.string().optional(),
                prompt: z.string().min(1).optional(),
                timezone: z.string().refine(zone => {
                    try {
                        new Intl.DateTimeFormat('en', { timeZone: zone })
                        return true
                    } catch {
                        return false
                    }
                }, 'Invalid time zone').optional(),
            })
            .parse(await c.req.json())
        const directory = join(config.dataDir, 'agents', 'main', 'ns-' + encodeURIComponent(c.get('namespace')))
        await mkdir(directory, { recursive: true })
        return c.json(
            await hub.hamlet.create(
                c.get('namespace'),
                null,
                'main',
                AgentConfig.parse({
                    machine_id: machine,
                    directory,
                    model: input.model,
                    name: '主 Agent',
                    description: '记录需求、委派任务并向用户汇总的秘书',
                    prompt: input.prompt ?? mainAgentPrompt,
                }),
                input.timezone,
            ),
        )
    })
}

export function hamletRoutes(get: () => SyncEngine | null) {
    const app = new Hono<{ Variables: { actor: Agent } }>()
    app.onError((e, c) => c.json({ error: e.message }, 400))
    const token = (auth?: string) => (auth?.startsWith('Bearer ') ? auth.slice(7) : '')
    app.post('/ring', async (c) => {
        const p = z
            .object({
                prompt: z.string().optional(),
                vars: z.record(z.string(), z.unknown()).optional(),
                dedup_key: z.string().optional(),
            })
            .parse(await c.req.json())
        const service = get()?.hamlet
        if (!service) return c.json({ error: 'Hub unavailable' }, 503)
        return c.json(
            service.store.ring(
                token(c.req.header('Authorization')),
                p.prompt ?? JSON.stringify(p.vars ?? {}),
                p.dedup_key ?? randomUUID(),
            ),
        )
    })
    app.use('*', async (c, next) => {
        const actor = get()?.hamlet.store.authenticate(token(c.req.header('Authorization')))
        if (!actor) return c.json({ error: 'Agent credential required' }, 401)
        c.set('actor', actor)
        return next()
    })
    app.post('/tool/:name', async (c) => {
        const name = c.req.param('name')
        if (!Object.hasOwn(hamletTools, name)) return c.json({ error: 'Unknown tool' }, 404)
        const actor = c.get('actor')
        if (name === 'notify_user' && actor.parent_id !== null) return c.json({ error: 'Main agent required' }, 403)
        return c.json(await get()!.hamlet.tool(actor, name as HamletTool, await c.req.json()))
    })
    app.post('/inbox', (c) => c.json(get()!.hamlet.claimInbox(c.get('actor').id)))
    app.post('/ack/:batch', (c) => {
        const service = get()!.hamlet
        const agent = c.get('actor').id
        const batch = c.req.param('batch')
        if (batch.startsWith('hamlet:steer:')) service.recordInputs(agent, service.store.batchEvents(agent, batch))
        else service.store.ack(agent, batch)
        return c.json({ ok: true })
    })
    const folder = () => join(getConfiguration().dataDir, 'hamlet-attachments')
    app.post('/attachments', bodyLimit({ maxSize: 25 * 1024 * 1024 }), async (c) => {
        const data = Buffer.from(await c.req.arrayBuffer())
        const claimed = c.req.header('Content-Type') ?? 'application/octet-stream'
        const image = detectImageMimeType(data)
        if (claimed.startsWith('image/') && !image) return c.json({ error: 'Invalid image' }, 400)
        const mime = image ?? claimed
        const id = randomUUID()
        const name = basename(decodeURIComponent(c.req.header('X-Filename') ?? 'attachment'))
        await mkdir(folder(), { recursive: true })
        const path = join(folder(), id)
        await writeFile(path, data, { flag: 'wx', mode: 0o600 })
        try {
            get()!.hamlet.store.addAttachment(id, c.get('actor').id, name, mime, data.length)
        } catch (e) {
            await unlink(path)
            throw e
        }
        return c.json({ attachment_id: id, name, mime })
    })
    app.get('/attachments/:id/info', (c) => {
        const a = get()!.hamlet.store.attachment(c.req.param('id'), c.get('actor').id)
        return a
            ? c.json({ attachment_id: a.id, name: a.name, mime: a.mime })
            : c.json({ error: 'Attachment unavailable' }, 404)
    })
    app.get('/attachments/:id', async (c) => {
        const a = get()!.hamlet.store.attachment(c.req.param('id'), c.get('actor').id)
        if (!a) return c.json({ error: 'Attachment unavailable' }, 404)
        return new Response(await readFile(join(folder(), a.id)), {
            headers: { 'content-type': a.mime, 'x-filename': encodeURIComponent(a.name) },
        })
    })
    return app
}
