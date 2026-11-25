import { basename, join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { configuration } from '@/configuration'
import type { ApiSessionClient } from '@/api/apiSession'
import { hamletToolDescriptions, hasMessageContent, hamletTools, steerInput, type HamletBatch } from '@hamlet/protocol/hamlet'
import {
    detectImageMimeType,
    detectDisplayMediaMimeType,
    MAX_GENERATED_IMAGE_BYTES,
    readBoundedRegularFile,
} from '@/modules/common/generatedImages'

const file = z.union([z.object({ path: z.string().min(1) }), z.object({ attachment_id: z.string().min(1) })])
const image = z.union([
    z.object({ path: z.string(), caption: z.string().optional() }),
    z.object({ attachment_id: z.string(), caption: z.string().optional() }),
])
export const managedTools = {
    ...hamletTools,
    wait_message: z.object({}),
    agent_steer: steerInput.extend({ images: z.array(image).default([]) }).refine(hasMessageContent, 'Provide text or images'),
    message_to: z.object({
        target: z.union([z.object({ agent_id: z.string() }), z.object({ group_id: z.string() })]),
        text: z.string().optional(),
        images: z.array(image).optional(),
        request_id: z.string().optional(),
    }).refine(hasMessageContent, 'Provide text or images'),
    display_media: z.object({
        source: file,
        kind: z.enum(['auto', 'image', 'video', 'audio', 'file']).default('auto'),
        title: z.string().optional(),
    }),
}
function eventHeader(e: HamletBatch['events'][number], steer: boolean, timezone?: string) {
    const kind = { initial: '首轮任务', message: steer ? '纠正' : '消息', timer: '提醒', doorbell: 'doorbell' }[e.kind]
    const at = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'UTC', timeZoneName: 'longOffset', hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(e.due_at ?? e.created_at)
    const source = e.kind === 'timer' ? 'timer_id=' + e.sender :
        e.kind === 'doorbell' ? [e.sender_name, 'doorbell_id=' + e.sender].filter(Boolean).join(' · ') :
        e.relation === '系统' ? '系统' :
        [e.sender_name, e.relation, 'agent_id=' + e.sender].filter(Boolean).join(' · ')
    return '[' + [kind, source, e.group_name && `群「${e.group_name}」`, e.group_id && 'group_id=' + e.group_id, at].filter(Boolean).join(' · ') + ']'
}

export function forSession(id: string) {
    return process.env.HAMLET_AGENT_ID === id && process.env.HAMLET_TOKEN
        ? new HamletClient(process.env.HAMLET_TOKEN)
        : undefined
}
export class HamletClient {
    constructor(private token: string) {}
    async fetch(path: string, init: RequestInit = {}) {
        const headers = new Headers(init.headers)
        headers.set('Authorization', 'Bearer ' + this.token)
        const res = await fetch(configuration.apiUrl + '/hamlet/' + path, { ...init, headers })
        if (!res.ok) throw new Error((await res.text()).slice(0, 1000))
        return res
    }
    private async upload(path: string, imageOnly: boolean) {
        const bytes = await readBoundedRegularFile(path, MAX_GENERATED_IMAGE_BYTES)
        const mime = imageOnly ? detectImageMimeType(bytes) : detectDisplayMediaMimeType(bytes)
        if (!mime && imageOnly) throw new Error('Unsupported image format')
        return (await (
            await this.fetch('attachments', {
                method: 'POST',
                body: new Uint8Array(bytes),
                headers: {
                    'Content-Type': mime ?? 'application/octet-stream',
                    'X-Filename': encodeURIComponent(basename(path)),
                },
            })
        ).json()) as { attachment_id: string; name: string; mime: string }
    }
    async batch() {
        return (await (await this.fetch('inbox', { method: 'POST' })).json()) as HamletBatch | null
    }
    async ack(id: string) {
        await this.fetch('ack/' + id, { method: 'POST' })
    }
    async input(batch: HamletBatch, agent: string) {
        const parts: { type: string; text?: string; path?: string }[] = []
        for (const e of batch.events) {
            parts.push({
                type: 'text',
                text: eventHeader(e, batch.id.startsWith('hamlet:steer:'), process.env.HAMLET_USER_TIMEZONE) + '\n' + e.text,
            })
            for (const img of e.images) {
                const res = await this.fetch('attachments/' + img.attachment_id)
                const bytes = Buffer.from(await res.arrayBuffer())
                if (!detectImageMimeType(bytes)) throw new Error('Invalid image attachment')
                const dir = join(configuration.happyHomeDir, 'hamlet-images', agent)
                await mkdir(dir, { recursive: true, mode: 0o700 })
                const path = join(dir, img.attachment_id)
                await writeFile(path, bytes, { mode: 0o600 })
                parts.push(
                    {
                        type: 'text',
                        text: ['图片', img.caption, '可转发或展示：attachment_id=' + img.attachment_id].filter(Boolean).join(' '),
                    },
                    { type: 'localImage', path },
                )
            }
        }
        return parts
    }
    register(server: McpServer, session: ApiSessionClient, cwd: string) {
        const names = Object.keys(managedTools) as (keyof typeof managedTools)[]
        for (const name of names) {
            if (name === 'machine_exec' && process.env.HAMLET_MAIN !== '1') continue
            server.registerTool<any, any>(
                name,
                {
                    description: hamletToolDescriptions[name],
                    inputSchema: managedTools[name] as z.ZodTypeAny,
                },
                async (raw: Record<string, unknown>) => {
                    try {
                        if (name === 'wait_message') {
                            // The native session controller handles the completed MCP item for this turn.
                            return { content: [{ type: 'text' as const, text: 'Yielding to the inbox. Continue on the next input.' }] }
                        }
                        let input: unknown = raw
                        if (name === 'message_to' || name === 'agent_steer') {
                            const p = managedTools[name].parse(raw)
                            const images = []
                            for (const i of p.images ?? []) {
                                const ref = 'path' in i ? await this.upload(resolve(cwd, i.path), true) : i
                                images.push({ attachment_id: ref.attachment_id, caption: i.caption })
                            }
                            input = { ...p, images }
                        }
                        if (name === 'display_media') {
                            const p = managedTools.display_media.parse(raw)
                            const ref =
                                'attachment_id' in p.source
                                    ? ((await (
                                          await this.fetch('attachments/' + p.source.attachment_id + '/info')
                                      ).json()) as { attachment_id: string; name: string; mime: string })
                                    : await this.upload(resolve(cwd, p.source.path), false)
                            if (!['auto', 'file'].includes(p.kind) && !ref.mime.startsWith(p.kind + '/'))
                                throw new Error('Media type mismatch')
                            session.sendAgentMessage({
                                type: 'generated-image',
                                imageId: 'hamlet:' + ref.attachment_id,
                                fileName: p.title ?? ref.name,
                                mimeType: ref.mime,
                                id: randomUUID(),
                                source: { ingress: 'mcp', toolName: 'display_media' },
                            })
                            return { content: [{ type: 'text' as const, text: ref.attachment_id }] }
                        }
                        const response = await this.fetch('tool/' + name, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(input),
                        })
                        return { content: [{ type: 'text' as const, text: await response.text() }] }
                    } catch (error) {
                        return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }
                    }
                },
            )
        }
    }
}
