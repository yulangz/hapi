import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getCodexSystemPrompt } from '@/codex/utils/systemPrompt'
import { HamletClient, managedTools } from './client'
import { hamletToolDescriptions, mainAgentPrompt } from '@hamlet/protocol/hamlet'
import { removeLegacyManagedSkill } from './legacySkill'
import { runtimePath } from '@/projectPath'

it('renders the sender, relationship and event-time offset in a managed input', async () => {
    vi.stubEnv('HAMLET_USER_TIMEZONE', 'America/Los_Angeles')
    try {
        const parts = await new HamletClient('fixture').input({ id: 'batch', events: [{
            kind: 'initial', seq: 1, sender: 'parent-id', sender_name: '秘书', relation: '父节点',
            created_at: Date.UTC(2026, 6, 1, 16), due_at: null, group_id: null, images: [], text: '检查日志',
        }] }, 'child-id')
        expect(parts[0].text).toBe('[Hamlet · 类型：首轮任务 · 发送者：秘书 · 关系：你的父节点 · 发送者 agent_id：parent-id · 时间：2026-07-01 09:00:00（America/Los_Angeles，UTC-07:00）]\n检查日志')
    } finally {
        vi.unstubAllEnvs()
    }
})

it('labels every header field for timers, doorbells, group messages and images', async () => {
    const at = Date.UTC(2026, 10, 25, 16)
    const parts = await new HamletClient('fixture').input({ id: 'hamlet:steer:x', events: [
        { kind: 'message', seq: 1, sender: 'p', sender_name: '秘书', relation: '父节点', created_at: at, due_at: null, group_id: 'g', group_name: '前端组', images: [], text: '停下' },
        { kind: 'timer', seq: 2, sender: 't', created_at: at, due_at: at, group_id: null, images: [], text: '跟进' },
        { kind: 'doorbell', seq: 3, sender: 'd', sender_name: 'ci', created_at: at, due_at: null, group_id: null, images: [], text: '完成' },
        { kind: 'dream', seq: 4, sender: 'hamlet-dream', created_at: at, due_at: null, group_id: null, images: [], text: '整理' },
    ] }, 'c')
    expect(parts.map((p) => p.text)).toEqual([
        '[Hamlet · 类型：紧急纠正（追加到你正在进行的回合） · 发送者：秘书 · 关系：你的父节点 · 发送者 agent_id：p · 群：前端组（group_id：g） · 时间：2026-11-25 16:00:00（UTC，UTC+00:00）]\n停下',
        '[Hamlet · 类型：提醒（你自己设的 timer） · timer_id：t · 计划时间：2026-11-25 16:00:00（UTC，UTC+00:00）]\n跟进',
        '[Hamlet · 类型：doorbell 事件 · doorbell：ci · doorbell_id：d · 时间：2026-11-25 16:00:00（UTC，UTC+00:00）]\n完成',
        '[Hamlet · 类型：整理笔记（每日定时提醒） · 时间：2026-11-25 16:00:00（UTC，UTC+00:00）]\n整理',
    ])
})

it('gives the main agent the user\'s brief without a Hamlet header', async () => {
    const parts = await new HamletClient('fixture').input({ id: 'batch', events: [{
        kind: 'initial', seq: 1, sender: 'system', sender_name: null, relation: '系统',
        created_at: Date.UTC(2026, 6, 1, 16), due_at: null, group_id: null, images: [], text: mainAgentPrompt,
    }] }, 'main-id')
    expect(parts[0].text).toBe(mainAgentPrompt)
    expect(parts[0].text).toContain('gpt-6.2-sol')
    expect(parts[0].text).toContain('gpt-6.2-astra')
})

it('leaves managed sessions on Codex defaults and carries the protocol in tool descriptions', () => {
    for (const env of [{ HAMLET_AGENT_ID: 'child' }, { HAMLET_AGENT_ID: 'main', HAMLET_MAIN: '1', HAMLET_SESSION_SUMMARY_CONTRACT: '1' }]) {
        expect(getCodexSystemPrompt(env)).toBe('')
    }
    expect(getCodexSystemPrompt({ HAMLET_SESSION_SUMMARY_CONTRACT: '1' })).toContain('AGENT_NOTIFY_SUMMARY')
    expect(hamletToolDescriptions.message_to).toContain('only visible in your own session')
    expect(hamletToolDescriptions.wait_message).toContain('instead of sleeping or polling')
    expect(hamletToolDescriptions.agent_steer).toContain('only when it is urgent')
    expect('agent_interrupt' in managedTools).toBe(false)
    expect(managedTools.agent_steer.safeParse({ agent_id: 'child', turn_id: 'turn', request_id: 'key', text: ' ' }).success).toBe(false)
    expect(managedTools.doorbell_create.safeParse({ name: 'w', script: 'x', max_rings: 0 }).success).toBe(false)
})

it('points the managed tools to the bundled guide and retires only the old Runner copy', async () => {
    const guide = join(runtimePath(), 'skills', 'hamlet-agent', 'SKILL.md')
    const contents = await readFile(guide, 'utf8')
    const described = new Map<string, string>()
    new HamletClient('fixture').register({
        registerTool: (name: string, spec: { description: string }) => described.set(name, spec.description),
    } as never, {} as never, '/work')
    for (const name of ['whoami', 'agent_create', 'doorbell_create']) expect(described.get(name)).toContain('`' + guide + '`')
    expect(described.has('machine_exec')).toBe(false)
    expect(getCodexSystemPrompt({})).not.toContain(guide)
    const home = await mkdtemp(join(tmpdir(), 'hamlet-managed-skill-'))
    try {
        await removeLegacyManagedSkill(home)
        const dir = join(home, 'skills', 'hamlet-agent')
        await mkdir(dir, { recursive: true })
        const file = join(dir, 'SKILL.md')
        expect(contents).toContain('from doorbell import every, ring, state')
        await writeFile(file, 'custom\n<!-- Installed by Hamlet Runner -->\n')
        await removeLegacyManagedSkill(home)
        expect(await readFile(file, 'utf8')).toContain('custom')
    } finally {
        await rm(home, { recursive: true, force: true })
    }
})

it.each(['1', '0'])('gates notify_user by HAMLET_MAIN=%s', (isMain) => {
    vi.stubEnv('HAMLET_MAIN', isMain)
    try {
        const tools = new Map<string, string>()
        new HamletClient('fixture').register({
            registerTool: (name: string, spec: { description: string }) => tools.set(name, spec.description),
        } as never, {} as never, '/work')
        expect(tools.has('notify_user')).toBe(isMain === '1')
        expect(tools.has('notify')).toBe(false)
        expect(tools.get('agent_create')).not.toMatch(/gpt-6\.2-(sol|astra)/)
    } finally {
        vi.unstubAllEnvs()
    }
})
