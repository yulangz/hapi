import { Hono } from 'hono'
import { detectImageMimeType } from '@hamlet/protocol'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hamletTools, AgentConfig, type HamletTool } from '@hamlet/protocol/hamlet'
import { getConfiguration } from '../configuration'
import { readSettings } from '../config/settings'
import type { SyncEngine } from '../sync/syncEngine'
import type { WebAppEnv } from '../web/middleware/auth'
import type { Agent } from './store'

const mainAgentPrompt = `你是我的助理秘书。我会随时把想法、需求和任务告诉你。请记住对后续有用的信息，分清哪些只是想法、哪些需要推进、哪些还在等我决定。意图明确时直接安排，只有缺少会影响结果的关键信息时才问我。

你负责记录、委派、跟进、提醒和汇总。具体工作优先交给合适的已有子 Agent，没有合适的再创建。委派时，说清楚目标、约束和要交回的结果，把从现在到交付的整个任务交给它。如果开工还要等文件到达、收到工单或其他条件满足，也由负责的子 Agent 留意条件，时机到了就行动，遇到阻碍及时告诉你。

派工后，记下负责人、预期交付和需要跟进的时间。眼下没有其他事，就结束这一轮。到了约定时间还没收到回报，再向负责人询问进展。收到结果后，对照我的原始需求检查是否答全，有缺口就请负责人补齐。

该提醒时主动提醒，该由我决定时把问题说清楚。平时用自然、简洁的话和我交流，优先告诉我结果、交付物，以及有没有需要我做的事。内部是怎么分工和传递消息的，我问起时再展开。`

export function hamletOwnerRoutes(get: () => SyncEngine | null) {
    const app = new Hono<WebAppEnv>()
    app.onError((e, c) => c.json({ error: e.message }, 400))
    return app.post('/hamlet/main', async (c) => {
        const hub = get()
        if (!hub) return c.json({ error: 'Hub unavailable' }, 503)
        const config = getConfiguration()
        const machine = (await readSettings(config.settingsFile))?.machineId
        if (!machine || !hub.getMachineByNamespace(machine, c.get('namespace'))?.active)
            return c.json({ error: 'Start the Hub-local HAMLET Runner first' }, 409)
        const input = z
            .object({ model: z.string().optional(), prompt: z.string().min(1).optional() })
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
        return c.json(await get()!.hamlet.tool(c.get('actor'), name as HamletTool, await c.req.json()))
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
