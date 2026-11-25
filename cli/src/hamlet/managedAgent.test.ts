import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getCodexSystemPrompt } from '@/codex/utils/systemPrompt'
import { HamletClient, managedTools } from './client'
import { removeLegacyManagedSkill } from './legacySkill'
import { runtimePath } from '@/projectPath'

it('renders the sender, relationship and event-time offset in a managed input', async () => {
    vi.stubEnv('HAMLET_USER_TIMEZONE', 'America/Los_Angeles')
    try {
        const parts = await new HamletClient('fixture').input({ id: 'batch', events: [{
            kind: 'initial', seq: 1, sender: 'parent-id', sender_name: '秘书', relation: '父节点',
            created_at: Date.UTC(2026, 6, 1, 16), due_at: null, group_id: null, images: [], text: '检查日志',
        }] }, 'child-id')
        expect(parts[0].text).toMatch(/首轮任务.*秘书.*父节点.*parent-id.*09:00:00 GMT-07:00\]\n检查日志/)
    } finally {
        vi.unstubAllEnvs()
    }
})

it('keeps the secretary role in managed instructions and rejects empty interventions', () => {
    const main = getCodexSystemPrompt({ HAMLET_AGENT_ID: 'main', HAMLET_MAIN: '1', HAMLET_USER_TIMEZONE: 'Asia/Shanghai', HAMLET_SESSION_SUMMARY_CONTRACT: '1' })
    for (const fragment of ['notes.md', 'timer_create', 'wait_message', 'Asia/Shanghai']) expect(main).toContain(fragment)
    expect(main).not.toContain('AGENT_NOTIFY_SUMMARY')
    expect(getCodexSystemPrompt({ HAMLET_SESSION_SUMMARY_CONTRACT: '1' })).toContain('AGENT_NOTIFY_SUMMARY')
    expect(getCodexSystemPrompt({ HAMLET_AGENT_ID: 'child' })).toContain('message_to 向它回报')
    expect(managedTools.agent_steer.safeParse({ agent_id: 'child', turn_id: 'turn', request_id: 'key', text: ' ' }).success).toBe(false)
})

it('points only managed sessions to the bundled guide and retires only the old Runner copy', async () => {
    const guide = join(runtimePath(), 'skills', 'hamlet-agent', 'SKILL.md')
    const contents = await readFile(guide, 'utf8')
    expect(getCodexSystemPrompt({ HAMLET_AGENT_ID: 'child' })).toContain(JSON.stringify(guide))
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
