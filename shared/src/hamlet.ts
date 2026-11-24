import { z } from 'zod'

const id = z.string().min(1)
const title = z.string().trim().min(1)
export const AgentConfig = z.object({
    harness: z.literal('codex').default('codex'),
    permission_mode: z.literal('yolo').default('yolo'),
    machine_id: id,
    directory: id,
    session_type: z.enum(['simple', 'worktree']).default('simple'),
    model: title.optional(),
    reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    collaboration_mode: z.enum(['default', 'plan']).default('default'),
    service_tier: z.enum(['standard', 'fast']).default('standard'),
    name: title,
    description: title,
    prompt: title,
})
export type AgentConfig = z.output<typeof AgentConfig>

export const ImageRef = z.object({ attachment_id: id, caption: z.string().optional() })
export const OutgoingMessage = z
    .object({
        target: z.union([z.object({ agent_id: id }), z.object({ group_id: id })]),
        text: z.string().default(''),
        images: z.array(ImageRef).default([]),
        request_id: id.optional(),
    })
    .refine((m) => m.text.trim() || m.images.length, 'Provide text or images')

const childTurn = z.object({ agent_id: id, turn_id: id.describe('Current turn_id returned by agent_list') })
export const hamletTools = {
    whoami: z.object({}),
    machine_list: z.object({}),
    agent_create: AgentConfig.extend({ request_id: id.describe('Stable key for retries of this creation') }),
    agent_list: z.object({ ids: z.array(id).optional() }),
    agent_interrupt: childTurn,
    agent_steer: childTurn.extend({ request_id: id.describe('Reuse for retries of the same correction'), text: z.string().default(''), images: z.array(ImageRef).default([]) }),
    agent_delete_status: z.object({}),
    agent_delete: z.object({ agent_id: id, force: z.boolean().default(false), subtree_version: id.optional() }),
    group_create: z.object({ name: title, members: z.array(id), include_self: z.boolean().default(false) }),
    group_update: z.object({ group_id: id, add: z.array(id).default([]), remove: z.array(id).default([]) }),
    group_delete: z.object({ group_id: id }),
    group_list: z.object({}),
    group_members: z.object({ group_id: id }),
    message_to: OutgoingMessage,
    timer_create: z.object({
        due_at: z.iso.datetime({ offset: true }),
        interval_seconds: z.number().int().positive().optional(),
        text: title,
    }),
    timer_list: z.object({}),
    timer_delete: z.object({ id }),
    doorbell_create: z.object({
        name: title,
        script: title.describe(
            'Executable script on your Runner. With #!/usr/bin/env doorbell-python, import ring, state, every from doorbell. Call ring(prompt="...", dedup_key="...") to wake yourself. state.get/set persist across restarts.',
        ),
    }),
    doorbell_logs: z.object({ id }),
    doorbell_list: z.object({}),
    doorbell_enable: z.object({ id, enabled: z.boolean() }),
    doorbell_delete: z.object({ id }),
    machine_exec: z.object({ machine_id: id, command: title, cwd: id.optional() }),
}
export type HamletTool = keyof typeof hamletTools
export const HamletChatSource = z.object({
    kind: z.enum(['initial', 'message', 'doorbell', 'timer']),
    sender: z.string().nullable(),
    group: z.string().nullable(),
    images: z.array(z.object({ id: id, name: z.string(), mime: z.string(), caption: z.string().optional() })),
})
export type HamletChatSource = z.infer<typeof HamletChatSource>

export const HamletTurn = z.object({
    turn_id: id,
    inputs: z.array(z.union([
        z.object({ batch_id: id }),
        z.object({ message_id: id, content: z.array(z.unknown()) }),
    ])),
})
export type HamletTurn = z.infer<typeof HamletTurn>

export type HamletBatch = {
    id: string
    events: {
        seq: number
        sender: string
        kind: HamletChatSource['kind']
        group_id: string | null
        created_at: number
        due_at: number | null
        text: string
        images: z.output<typeof ImageRef>[]
    }[]
}
