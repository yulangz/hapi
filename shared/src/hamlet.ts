import { z } from 'zod'

const id = z.string().min(1)
const nonEmpty = z.string().trim().min(1)
export const AgentConfig = z.object({
    harness: z.literal('codex').default('codex'),
    permission_mode: z.literal('yolo').default('yolo'),
    machine_id: id.describe('machine_list 返回的稳定 ID'),
    directory: id.describe('目标机器上的绝对工作目录'),
    session_type: z.enum(['simple', 'worktree']).default('simple').describe('simple 使用原目录；worktree 从 Git 仓库创建独立工作树'),
    model: nonEmpty.optional(),
    reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    collaboration_mode: z.enum(['default', 'plan']).default('default'),
    service_tier: z.enum(['standard', 'fast']).default('standard'),
    name: nonEmpty.describe('在会话和来信中展示的简短名字'),
    description: nonEmpty.describe('一句话说明负责什么'),
    prompt: nonEmpty.describe('子节点看不到父节点的聊天记录。写清目标、输入位置、约束、交付物和验收标准，约定完成、受阻时用 message_to 回报。'),
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
    .refine(hasMessageContent, 'Provide text or images')

export function hasMessageContent(input: { text?: string; images?: unknown[] }) {
    return Boolean(input.text?.trim() || input.images?.length)
}

const childTurn = z.object({ agent_id: id, turn_id: id.describe('Current turn_id returned by agent_list') })
export const steerInput = childTurn.extend({ request_id: id.describe('同一次纠正重试时沿用'), text: z.string().default(''), images: z.array(ImageRef).default([]) })
export const hamletTools = {
    whoami: z.object({}),
    machine_list: z.object({}),
    agent_create: AgentConfig.extend({ request_id: id.describe('Stable key for retries of this creation') }),
    agent_list: z.object({ ids: z.array(id).optional() }),
    agent_interrupt: childTurn,
    agent_steer: steerInput.refine(hasMessageContent, 'Provide text or images'),
    agent_delete_status: z.object({}),
    agent_delete: z.object({ agent_id: id, force: z.boolean().default(false), subtree_version: id.optional() }),
    group_create: z.object({ name: nonEmpty, members: z.array(id), include_self: z.boolean().default(false) }),
    group_update: z.object({ group_id: id, add: z.array(id).default([]), remove: z.array(id).default([]) }),
    group_delete: z.object({ group_id: id }),
    group_list: z.object({}),
    group_members: z.object({ group_id: id }),
    message_to: OutgoingMessage,
    timer_create: z.object({
        due_at: z.iso.datetime({ offset: true }).describe('例如 2026-11-25T09:00:00+08:00 或 UTC 的 Z 后缀'),
        interval_seconds: z.number().int().positive().optional(),
        text: nonEmpty,
    }),
    timer_list: z.object({}),
    timer_delete: z.object({ id }),
    doorbell_create: z.object({
        name: nonEmpty,
        script: nonEmpty.describe(
            '传完整脚本源码。Python 用 #!/usr/bin/env python3 和 from doorbell import every, ring, state。用 @every(seconds=60) 注册检查，顶层返回后立即开始轮询。事件发生时用 ring(prompt="发生了什么、路径和下一步", dedup_key="稳定事件标识")，成功后用 state.set 保存游标。详见 hamlet-agent skill。',
        ),
    }),
    doorbell_logs: z.object({ id }),
    doorbell_list: z.object({}),
    doorbell_enable: z.object({ id, enabled: z.boolean() }),
    doorbell_delete: z.object({ id }),
    machine_exec: z.object({ machine_id: id, command: nonEmpty, cwd: id.optional() }),
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
        sender_name?: string | null
        relation?: '系统' | '父节点' | '直属子节点' | '同群成员' | null
        group_name?: string | null
        kind: HamletChatSource['kind']
        group_id: string | null
        created_at: number
        due_at: number | null
        text: string
        images: z.output<typeof ImageRef>[]
    }[]
}

export const hamletToolDescriptions: Record<HamletTool | 'wait_message' | 'display_media', string> = {
    whoami: '查看自己与父节点的身份和运行状态。用 group_list 查看自己的群。',
    machine_list: '列出机器的稳定 machine_id、可修改的显示名和在线状态。创建 Agent 时使用 machine_id。',
    agent_create: '在指定机器创建直属子 Agent，提交首轮任务。重试同一次创建时沿用 request_id。',
    agent_list: '按 ids 查询直属子节点，省略则列出全部。返回名字、职责、title、运行状态和当前回合正在处理的输入。运行中可获取 turn_id。',
    agent_interrupt: '请求停止直属子节点指定的 turn_id，保留会话和收件箱。返回 turn_changed 时请重新确认状态。',
    agent_steer: '将纠正文字或图片立即加入直属子节点指定的运行回合。用 agent_list 获取 turn_id，重试沿用 request_id。若回合已结束，可用 message_to 派后续任务。',
    agent_delete: '删除直属子节点。有后代时先返回预览；确认级联删除后携带预览的 subtree_version 和 force=true 重试。子树变化时需重新确认。保留工作目录。',
    agent_delete_status: '查询你发起的删除仍待 Runner 清理的节点。',
    group_create: '用直属子节点组成跨机器群。创建者要发出或收到群广播时传 include_self=true。返回群的 id。',
    group_update: '增减自己创建的群的成员，可加入自己和直属子节点。',
    group_delete: '解散自己创建的群。',
    group_list: '列出你创建或加入的群，joined 表示自己是否在群中。',
    group_members: '查看群成员的身份、职责、title 和运行状态。',
    message_to: '私信父节点、直属子节点或同群成员，或向已加入的群广播给其他成员。忙时排队，下个空闲回合批量送达。每张图片用本机路径或已有 attachment_id，可附说明。重试同一条消息时沿用 request_id 才会去重。',
    timer_create: '给自己设提醒。due_at 用带时区的 ISO 8601 时间，text 写明到时该做什么。interval_seconds 可设置重复周期，错过的多个周期合并投递。',
    timer_list: '列出自己的定时提醒。',
    timer_delete: '取消自己的提醒。在收到所等回报或任务取消时清理后续提醒。',
    doorbell_create: '让所在机器的 Runner 在你的工作目录运行监听脚本，ring 时才投递事件。脚本退出后退避重启。自定义路径和参数请写入源码，项目环境变量不会自动传入。用 doorbell_list 确认状态，出错用 doorbell_logs。',
    doorbell_list: '查看自己的监听、运行状态和最近的错误。',
    doorbell_enable: '暂停或启用自己的监听，保留脚本与持久状态。',
    doorbell_logs: '查看自己监听脚本最近 64 KiB 的输出和错误。',
    doorbell_delete: '删除自己的监听并停止脚本。',
    machine_exec: '主 Agent 可在指定在线机器执行短命令，查看环境或确认路径。超时 60 秒，输出缓冲上限 1 MiB；离线直接返回。项目工作交给该机器的子节点。',
    wait_message: '等待新的用户输入、Agent 消息、提醒或 doorbell。先用 message_to 发出需要的回报，再单独调用本工具作为本轮最后一个动作。已有积压会在下一轮投递。',
    display_media: '在当前会话向用户展示文件。source 接受本机路径或收到的 attachment_id。向其他 Agent 交付图片请用 message_to。',
}

export const mainAgentRole = `你是用户的助理秘书。用户在你的会话里提出想法、需求和任务，并在这里看你的回复。保持主会话标题稳定。
每轮开始读工作目录的 notes.md，初次使用时创建。记录需要推进的事、想法和待决定的问题。意图明确就安排，只有缺少会改变结果的信息时才问用户。
具体工作优先交给职责合适的已有子 Agent，否则创建。委派从准备到交付的完整任务，等待文件或外部事件也由负责人在自己的机器上建立 doorbell。machine_exec 仅用于必要的简短环境确认。
派工后在 notes.md 记录负责人、预期交付和跟进时间，用 timer_create 设置到期提醒。剩下的事需要等待时调用 wait_message。等待期间以回报为准，到期再向负责人询问。
收到回报后更新记录，清理对应提醒，对照需求验收。有缺口请负责人补齐。给用户的回复先说结果、交付物和待决定的事，图片可用 display_media 展示。用户问起时再介绍内部协作。`
