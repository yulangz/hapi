import { z } from 'zod'

const id = z.string().min(1)
const nonEmpty = z.string().trim().min(1)
export const AgentConfig = z.object({
    harness: z.literal('codex').default('codex'),
    permission_mode: z.literal('yolo').default('yolo'),
    machine_id: id.describe('machine_id from machine_list'),
    directory: id.describe('Absolute working directory on that machine'),
    session_type: z.enum(['simple', 'worktree']).default('simple').describe('simple: work in `directory` itself. worktree: create a separate Git worktree from the repository at `directory`, so several agents can change one repository in parallel'),
    model: nonEmpty.optional(),
    reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    collaboration_mode: z.enum(['default', 'plan']).default('default'),
    service_tier: z.enum(['standard', 'fast']).default('standard'),
    name: nonEmpty.describe('Short name shown in the UI and in the headers of its messages'),
    description: nonEmpty.describe('One sentence on what this agent is responsible for'),
    prompt: nonEmpty.describe('The first task, and everything the child knows: it cannot see your conversation. State the goal, where the inputs are, the constraints, the deliverable and how to tell it is done, and ask it to report back with message_to when it is done, blocked or needs a decision. If the work has to wait for something external, tell it to set up its own doorbell.'),
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

export const steerInput = z.object({
    agent_id: id.describe('A direct child'),
    turn_id: id.describe('The turn the child is running now, from agent_list'),
    request_id: id.describe('Reuse when retrying the same correction'),
    text: z.string().default(''),
    images: z.array(ImageRef).default([]),
})
export const hamletTools = {
    whoami: z.object({}),
    machine_list: z.object({}),
    agent_create: AgentConfig.extend({ request_id: id.describe('Idempotency key: reuse it when retrying the same creation') }),
    agent_list: z.object({ ids: z.array(id).optional() }),
    agent_steer: steerInput.refine(hasMessageContent, 'Provide text or images'),
    agent_delete_status: z.object({}),
    agent_delete: z.object({ agent_id: id, force: z.boolean().default(false), subtree_version: id.optional() }),
    group_create: z.object({ name: nonEmpty, members: z.array(id), include_self: z.boolean().default(false) }),
    group_update: z.object({ group_id: id, add: z.array(id).default([]), remove: z.array(id).default([]) }),
    group_delete: z.object({ group_id: id }),
    group_list: z.object({}),
    group_members: z.object({ group_id: id }),
    message_to: OutgoingMessage,
    notify_user: z.strictObject({
        text: nonEmpty.refine(text => Array.from(text).length <= 60, 'Use at most 60 Unicode characters')
            .describe('One sentence summarizing the update, up to 60 Unicode characters'),
        request_id: nonEmpty.max(128).describe('Unique key for this request. Duplicate calls with the same key and text queue one notification.'),
    }),
    timer_create: z.object({
        due_at: z.iso.datetime({ offset: true }).describe('ISO 8601 with an offset, e.g. 2026-11-25T09:00:00-07:00'),
        interval_seconds: z.number().int().positive().optional().describe('Repeat every N seconds; omit for a one-off reminder'),
        text: nonEmpty.describe('What to do when it fires; it is delivered to you as-is'),
    }),
    timer_list: z.object({}),
    timer_delete: z.object({ id }),
    doorbell_create: z.object({
        name: nonEmpty.describe('Short name; shown in the header of each event'),
        script: nonEmpty.describe(
            'Full Python source, not a file path. Import the bundled SDK with `from doorbell import every, ring, state` and decorate a check function with `@every(seconds=N)`. ' +
                'Polling starts once the module has loaded, with the first check immediately, so do not block or loop at top level. ' +
                'When the event happens call `ring(prompt=..., dedup_key=...)`: the prompt is all you will see when woken, so say what happened, the relevant paths or IDs and what to do next; ' +
                'a stable dedup_key (a job ID, a file path plus mtime) delivers each event once. Keep cursors with `state.get` / `state.set`, updating them after a successful ring. ' +
                'Only PATH and HOME are inherited, so write paths and parameters into the script.',
        ),
        max_rings: z.number().int().positive().optional().describe(
            'Stop after delivering this many events: 1 for a one-off wait, any N, or omit for no limit',
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
    kind: z.enum(['initial', 'message', 'doorbell', 'timer', 'dream']),
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
    whoami:
        'Show who you are (agent_id, name, description, machine, status), your parent agent if you have one, and the user\'s time zone. ' +
        'Inputs delivered by Hamlet start with a bracketed `[Hamlet · …]` header whose labelled fields give the input type, sender, your relationship to the sender, IDs and time; input without such a header was typed by the user in your session.',
    machine_list:
        'List the machines in this workspace: the stable machine_id, the display name (users may rename it) and whether its Runner is online. Always refer to machines by machine_id.',
    agent_create:
        'Create a child agent on a machine and submit `prompt` as its first task. The child is a full Codex session working in `directory`, and it reports to you. ' +
        'Prefer reusing an existing child whose role fits (see agent_list) and send it the new task with message_to. ' +
        'Retrying with the same request_id returns the same child instead of creating another. Returns the child\'s card, including its agent_id.',
    agent_list:
        'List your direct children, or the ones in `ids`. Each card shows name, description, current title, machine and status (working, idle or inactive); ' +
        'a working child also shows its current turn_id and the inputs that turn is processing. Reading this does not consume or interrupt anything.',
    agent_steer:
        'Inject text or images into the turn a direct child is running right now, so it sees them before that turn ends. ' +
        'Use it only when it is urgent: the child is clearly heading the wrong way, is about to do something harmful or irreversible, or must stop now. ' +
        'For anything else use message_to, which reaches the child at its next turn. Take turn_id from agent_list; ' +
        'a turn_changed result means that turn already ended, so check agent_list again or use message_to.',
    agent_delete:
        'Delete a direct child. A child without descendants is deleted at once. If it has descendants nothing is deleted: you get a preview of the whole subtree and a subtree_version, ' +
        'and you confirm by calling again with force=true and that subtree_version. If the subtree changed in between you get a new preview. ' +
        'Deleting stops the agents\' sessions, reminders and doorbells; their working directories and files are kept.',
    agent_delete_status: 'List agents from deletions you started that are still waiting for an offline machine to finish cleaning up.',
    group_create:
        'Create a group from your direct children, on any machines, so they can message each other and receive broadcasts. ' +
        'Only members send and receive group messages; set include_self=true if you need to as well. Returns the group id.',
    group_update: 'Add or remove members of a group you created. Members can be yourself or your direct children.',
    group_delete: 'Delete a group you created.',
    group_list: 'List the groups you created or belong to; `joined` says whether you are a member.',
    group_members: 'Show the members of a group: agent_id, name, description, title and status.',
    message_to:
        'Send a message to one agent (target.agent_id: your parent, a direct child, or a member of a group you are in), or to every other member of a group you belong to (target.group_id). ' +
        'Your ordinary replies are only visible in your own session: your parent and other agents see nothing unless you message them, so report results, blockers and questions here. ' +
        'If the recipient is busy the message waits and arrives with any others as one input at its next turn. ' +
        'Attach images by local path or by an attachment_id you received, each with an optional caption. Reuse request_id when retrying so the message is not sent twice.',
    notify_user:
        'When the user needs to act or decide, has an important update to read, or asked to be notified, call this tool first, then write the full details in the current conversation. ' +
        'Use one sentence of at most 60 Unicode characters and combine updates from the same turn. Use chat alone when replying to the user\'s latest message, for ordinary progress, or when a child finishes as planned and needs no user action. ' +
        'The tool confirms queue acceptance. The Hub handles delivery and retries.',
    timer_create:
        'Schedule a reminder for yourself. At due_at, `text` is delivered to you as an input, so write what you should do then ' +
        '(e.g. "Ask the parser agent for its report, which was due at 18:00"). Interpret times such as "tomorrow at 9" in the user\'s time zone (see whoami). ' +
        'interval_seconds makes it repeat; missed occurrences are merged into one. Delete reminders you no longer need with timer_delete.',
    timer_list: 'List your reminders.',
    timer_delete: 'Delete one of your reminders, e.g. once the report you were waiting for has arrived or the task was cancelled.',
    doorbell_create:
        'Watch for an external event without spending your own turns on it. A doorbell is a Python script that the Runner on your machine keeps running in your working directory; ' +
        'checking costs no model calls, and you are woken only when the script calls ring(). Use one whenever you would otherwise wait on something outside the conversation: ' +
        'a file or report appearing, a job, build or CI run finishing, a web page, API, queue or inbox changing, a service going up or down. ' +
        'A crashed script is restarted with backoff, and doorbells survive Runner restarts. max_rings limits how many events it delivers; ' +
        'when the limit is reached it stops by itself and the last event says so. Check on it with doorbell_list and doorbell_logs.',
    doorbell_list: 'List your doorbells with their status (pending, running, backoff, stopped or completed), how many times each has rung and its limit, and the last error.',
    doorbell_enable: 'Pause or resume one of your doorbells; its script and saved state are kept. Resuming a completed doorbell starts its count again from zero.',
    doorbell_logs: 'Show the last 64 KiB of a doorbell script\'s output and errors. Use it when the status is backoff or nothing rings.',
    doorbell_delete: 'Delete one of your doorbells and stop its script. Remove watchers once what they watch no longer matters.',
    machine_exec:
        'Run one shell command on an online machine and get stdout, stderr and the exit code. Meant for quick checks, such as machine state or whether a path or tool exists. ' +
        'Limited to 60 seconds and 1 MiB of output, and fails at once if the machine is offline. Project work belongs to a child agent on that machine.',
    wait_message:
        'End your turn and wait for the next input: a user message, a message from another agent, a reminder or a doorbell. Use this instead of sleeping or polling in your turn. ' +
        'Before calling it, deliver whatever is due: with message_to if you have a parent, or in your reply if you are talking to the user directly. ' +
        'Call it alone, as the last action of the turn. Inputs that queued up in the meantime arrive together at the next turn.',
    display_media:
        'Show a file (image, video, audio or other) to the user in your own session. `source` is a local path or an attachment_id you received. ' +
        'To hand a file to another agent, attach it with message_to instead.',
}

/** First input of the main agent, written in the user's own voice. */
export const mainAgentPrompt = `你是我的助理秘书。我会随时把想法、需求和任务告诉你。请记住对后续有用的信息，分清哪些只是想法、哪些需要推进、哪些还在等我决定。意图明确时直接安排，只有缺少会影响结果的关键信息时才问我。

善用文件系统来进行记录，好记性不如烂笔头。你的笔记应当简洁、工整、有层次，明确区分哪些是重要信息、哪些应该归档等等，我会定期提醒你整理笔记。

你负责记录、委派、跟进、提醒和汇总。具体工作优先交给合适的已有子 Agent，没有合适的再创建。创建子 Agent 时，在 agent_create 的 model 参数中明确指定模型。简单日常任务用 gpt-6.2-sol。有一定难度或需要深入判断的任务，优先用 gpt-6.2-astra。我的额度充足，无需为了省额度降低模型。委派时，说清楚目标、约束和要交回的结果，把从现在到交付的整个任务交给它。如果开工还要等文件到达、收到工单或其他条件满足，也由负责的子 Agent 留意条件，时机到了就行动，遇到阻碍及时告诉你。

派工后，记下负责人、预期交付和需要跟进的时间。眼下没有其他事，就结束这一轮。到了约定时间还没收到回报，再向负责人询问进展。收到结果后，对照我的原始需求检查是否答全，有缺口就请负责人补齐。

需要我介入或决定、有重要信息要告诉我，或我明确要求提醒时，用 notify_user 叫我回来：先调用 notify_user 通知我，再在会话里把完整内容写清楚。通知文本用一句简述内容，不超过 60 字。如果这一轮是在回复我刚发来的消息，我就在会话里，不必通知。同一轮的多件事合并成一条通知。普通进度、子 Agent 按计划完成且不需要我处理的，只在会话里说。`

/**
 * When the main agent is reminded to consolidate its notes: daily at `time` in `timezone`.
 * A Hub that was down then still sends it within `graceMinutes`; later, that day is skipped.
 */
export const mainAgentDreamSchedule = { time: '04:00', timezone: 'Asia/Shanghai', graceMinutes: 120 } as const

/** The daily reminder, in the user's voice like the brief it follows up on. */
export const mainAgentDreamPrompt = `到整理笔记的时间了。把上次整理以来的经历沉淀成以后用得上的笔记：你的会话很长，早期对话会被压缩，以后要靠这些笔记快速进入状态。

如果这批输入里还有其他消息，先处理它们，再整理笔记。整理期间只动笔记文件，不推进其他任务，也不给子 Agent 发消息。

1. 盘点：看一遍笔记的总览和各个文件，弄清现在记了什么、放在哪。
2. 收集：回顾上次整理以来的对话、回报和事件，找出新的事实、决定和变化，以及和已有笔记对不上的地方。记不清的，先查原始回报或相关文件再下结论，不要凭印象改。
3. 合并：新信息写进已有的主题文件，不要另开新文件；合并重复的条目。被后来的信息推翻的，在原处改正，并注明改自什么、何时改的；两种说法都有依据又判断不了的，两条都留下并标「待确认」。相对日期一律改成绝对日期。密钥和密码单独保存在一个文件里，笔记中只写它在哪里。
4. 归档与总览：已完成或不再相关的内容移到归档；总览只保留当前要紧的事和其他文件的位置，控制在一两百行以内，删掉失效的指向。

上次整理以来没有新内容时，不必改动笔记，回一句即可。整理完用两三句话告诉我改了什么，以及有没有需要我确认的事。`
