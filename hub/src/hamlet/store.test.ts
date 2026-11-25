import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentConfig, mainAgentDreamPrompt, mainAgentDreamSchedule, mainAgentPrompt } from '@hamlet/protocol/hamlet'
import { Store } from '../store'
import { HamletService } from './service'
import type { SyncEngine } from '../sync/syncEngine'
import type { RpcGateway } from '../sync/rpcGateway'
import { HamletStore, type Agent } from './store'
import type { Database } from 'bun:sqlite'

let dir: string
let hub: Store
let main: Agent
function child(parent: Agent | null, key: string, machine = 'hub') {
    const agent = hub.hamlet.register(
        'default',
        parent?.id ?? null,
        key,
        AgentConfig.parse({
            machine_id: machine,
            directory: '/workspace',
            name: key,
            description: key,
            prompt: 'Start ' + key,
        }),
    )
    return agent
}
function ready(a: Agent) {
    const batch = hub.hamlet.claim(a.id)!
    hub.hamlet.ack(a.id, batch.id)
}
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hamlet-test-'))
    hub = new Store(join(dir, 'test.db'))
    for (const id of ['hub', 'remote']) hub.machines.getOrCreateMachine(id, {}, null, 'default')
    main = child(null, 'main')
    ready(main)
})
afterEach(() => {
    hub.close()
    rmSync(dir, { recursive: true, force: true })
})

test('the main agent starts from the owner brief, and a later open keeps the recorded time zone', () => {
    const db = hub.hamlet
    const config = AgentConfig.parse({ machine_id: 'hub', directory: '/work', name: 'main', description: 'main', prompt: mainAgentPrompt })
    const agent = db.register('another-owner', null, 'main', config, 'Asia/Shanghai')
    db.register('another-owner', null, 'main', config)
    expect(db.userTimezone('another-owner')).toBe('Asia/Shanghai')
    hub.sessions.getOrCreateSession('owner-main', {}, null, 'another-owner', undefined, undefined, undefined, agent.id)
    const batch = db.claim(agent.id)!
    expect(batch.events[0]).toMatchObject({ kind: 'initial', relation: '系统', text: mainAgentPrompt })
    expect(db.recordInputs(agent.id, batch.events)[0].content).toMatchObject({ content: { text: mainAgentPrompt } })
})

test('the main agent is reminded to consolidate its notes once a day at 04:00 Beijing time', () => {
    const db = hub.hamlet
    const worker = child(main, 'worker')
    ready(worker)
    const before = Date.UTC(2026, 10, 24, 19, 59) // 03:59 in Beijing
    const at = Date.UTC(2026, 10, 24, 20, 0)
    db.remindDream(before, mainAgentDreamSchedule, mainAgentDreamPrompt)
    expect(db.claim(main.id)).toBeNull()
    db.remindDream(at + 60_000, mainAgentDreamSchedule, mainAgentDreamPrompt)
    db.remindDream(at + 120_000, mainAgentDreamSchedule, mainAgentDreamPrompt)
    const batch = db.claim(main.id)!
    expect(batch.events).toMatchObject([{ kind: 'dream', text: mainAgentDreamPrompt }])
    hub.sessions.getOrCreateSession('main-session', {}, null, 'default', undefined, undefined, undefined, main.id)
    expect(db.recordInputs(main.id, batch.events)[0].content).toMatchObject({ meta: { hamlet: { kind: 'dream', sender: null } } })
    db.ack(main.id, batch.id)
    expect(db.claim(worker.id)).toBeNull()
    // A Hub restarted later the same morning does not remind again; one down past the grace period skips the day.
    const restarted = new HamletStore((db as unknown as { db: Database }).db)
    restarted.remindDream(at + 3_600_000, mainAgentDreamSchedule, mainAgentDreamPrompt)
    expect(db.claim(main.id)).toBeNull()
    // The next day: still sent just inside the 2-hour window, never once it has passed.
    const late = new HamletStore((db as unknown as { db: Database }).db)
    late.remindDream(at + 86_400_000 + 2 * 3_600_000, mainAgentDreamSchedule, mainAgentDreamPrompt)
    expect(db.claim(main.id)).toBeNull()
    late.remindDream(at + 2 * 86_400_000 + 2 * 3_600_000 - 60_000, mainAgentDreamSchedule, mainAgentDreamPrompt)
    expect(db.claim(main.id)?.events).toMatchObject([{ kind: 'dream' }])
})

test('a doorbell with a ring limit stops itself, says so in its last event, and can be re-armed', () => {
    const a = child(main, 'watcher-owner')
    ready(a)
    const db = hub.hamlet
    const { id } = db.addDoorbell(a.id, 'ci', 'print(1)', 2)
    const token = db.manifest('hub').find((b) => b.id === id)!.token
    expect(db.ring(token, 'first', 'k1')).toMatchObject({ event_id: expect.any(Number) })
    expect(db.ring(token, 'first again', 'k1')).toEqual({ duplicate: true })
    expect(db.ring(token, 'second', 'k2')).toMatchObject({ completed: true })
    expect(db.ring(token, 'late', 'k3')).toEqual({ completed: true })
    expect(db.manifest('hub').some((b) => b.id === id)).toBe(false)
    expect(db.doorbells(a.id)).toMatchObject([{ id, status: 'completed', enabled: 0, rings: 2, max_rings: 2 }])
    const texts = db.claim(a.id)!.events.map((e) => e.text)
    expect(texts[0]).toBe('first')
    expect(texts[1]).toMatch(/^second\n\n.*2 次.*已自动停止/)
    db.setDoorbell(a.id, id, true)
    expect(db.doorbells(a.id)).toMatchObject([{ status: 'pending', enabled: 1, rings: 0 }])
    const unlimited = db.addDoorbell(a.id, 'feed', 'print(1)')
    const feed = db.manifest('hub').find((b) => b.id === unlimited.id)!.token
    for (const key of ['a', 'b', 'c']) expect(db.ring(feed, key, key)).not.toHaveProperty('completed')
})

test('cross-machine group, direct parent exceptions, idempotent retry and batch boundary', () => {
    const a = child(main, 'a'),
        b = child(main, 'b', 'remote'),
        c = child(a, 'c')
    expect(hub.hamlet.claim(c.id)?.events[0]).toMatchObject({ kind: 'initial', sender: a.id, sender_name: 'a', relation: '父节点' })
    for (const agent of [a, b, c]) ready(agent)
    expect(child(main, 'b', 'remote').id).toBe(b.id)
    const store = hub.hamlet
    const group = store.createGroup(main, 'pair', [a.id, b.id], false).id
    const post = (source: Agent, target: { group_id: string } | { agent_id: string }, text: string) =>
        store.send(source, { target, text, images: [], request_id: text })
    expect(() => store.updateGroup(main, group, [c.id], [])).toThrow()
    expect(() => store.deleteGroup(a, group)).toThrow()
    expect(() => post(c, { agent_id: main.id }, 'cross-level')).toThrow()
    expect(() => post(main, { group_id: group }, 'owner outside')).toThrow()
    post(a, { group_id: group }, 'one')
    post(main, { agent_id: b.id }, 'two')
    post(a, { group_id: group }, 'one')
    const batch = store.claim(b.id)!
    expect(batch.events.map((e) => e.text)).toEqual(['one', 'two'])
    expect(store.claim(main.id)).toBeNull()
    post(a, { agent_id: b.id }, 'three')
    store.updateGroup(main, group, [], [b.id])
    hub.close()
    hub = new Store(join(dir, 'test.db'))
    expect(hub.hamlet.claim(b.id)).toEqual(batch)
    hub.hamlet.ack(b.id, batch.id)
    expect(hub.hamlet.claim(b.id)?.events.map((e) => e.text)).toEqual(['three'])
})

test('timer coalesces missed ticks and doorbell token is scoped and revocable', () => {
    const a = child(main, 'a')
    ready(a)
    const db = hub.hamlet
    const { id } = db.addTimer(a.id, 10, 10, 'check')
    db.deleteTimer(main.id, id)
    db.fire(49)
    db.fire(49)
    expect(db.timers(a.id)).toMatchObject([{ due: 50 }])
    const bell = db.addDoorbell(a.id, 'watch', 'script')
    const [spec] = db.manifest('hub')
    db.ring(spec.token, 'hello', 'once')
    db.ring(spec.token, 'hello', 'once')
    db.setDoorbell(main.id, bell.id, false)
    expect(db.manifest('hub')).toHaveLength(1)
    db.setDoorbell(a.id, bell.id, false)
    expect(() => db.ring(spec.token, 'no', 'again')).toThrow()
    expect(db.claim(a.id)?.events.map((e) => e.kind)).toEqual(['timer', 'doorbell'])
})

test('attachments follow actual recipients and cascade confirmation checks membership of subtree', () => {
    const a = child(main, 'a'),
        b = child(a, 'b', 'remote'),
        outsider = child(main, 'outsider')
    hub.hamlet.addAttachment('photo', b.id, 'x.png', 'image/png', 2)
    hub.hamlet.send(b, { target: { agent_id: a.id }, text: '', images: [{ attachment_id: 'photo' }] })
    expect(hub.hamlet.attachment('photo', a.id)?.name).toBe('x.png')
    expect(hub.hamlet.attachment('photo', outsider.id)).toBeNull()
    const first = hub.hamlet.deleteTree(main, a.id, false)
    child(a, 'c')
    const second = hub.hamlet.deleteTree(main, a.id, true, first.subtree_version)
    expect(second.deleted).toBe(false)
    expect(hub.hamlet.deleteTree(main, a.id, true, second.subtree_version)).toEqual({ deleted: true, count: 3 })
    expect(hub.hamlet.cleanup()).toHaveLength(3)
    expect(hub.hamlet.authenticate(b.token)).toBeNull()
    expect(hub.hamlet.agent(outsider.id)).not.toBeNull()
})

test('restores an acknowledged prompt at its original position and mirrors each received event once', () => {
    const db = hub.hamlet
    hub.sessions.getOrCreateSession('main', {}, null, 'default', undefined, undefined, undefined, main.id)
    hub.messages.addMessage(main.id, { role: 'agent', content: { type: 'text', text: 'reply' } })
    db.restoreInitialInputs()
    db.restoreInitialInputs()
    const initial = hub.messages.getMessages(main.id, 100).filter(row => row.localId?.startsWith('hamlet-event:'))
    expect(initial).toHaveLength(1)
    expect(initial[0].content).toMatchObject({ content: { text: 'Start main' }, meta: { hamlet: { kind: 'initial' } } })
    expect(db.claim(main.id)).toBeNull()

    const sender = child(main, 'worker')
    const group = db.createGroup(main, 'project', [sender.id], true)
    db.addAttachment('pic', sender.id, 'sample.png', 'image/png', 100)
    db.send(sender, { target: { group_id: group.id }, text: '', images: [{ attachment_id: 'pic', caption: 'sample' }] })
    db.addTimer(main.id, 1, null, 'follow up')
    db.fire(10)
    db.addDoorbell(main.id, 'watcher', 'script')
    db.ring(db.manifest('hub')[0].token, 'change detected', 'once')
    const batch = db.claim(main.id)!
    expect(batch.events).toMatchObject([
        { sender: sender.id, sender_name: 'worker', group_name: 'project', relation: '直属子节点' },
        { kind: 'timer', due_at: 1 },
        { kind: 'doorbell', sender_name: 'watcher' },
    ])
    const rows = db.recordInputs(main.id, batch.events)
    expect(rows.map(row => row.content)).toMatchObject([
        { meta: { sentFrom: 'cli', hamlet: { kind: 'message', sender: 'worker', group: 'project', images: [{ id: 'pic', caption: 'sample' }] } } },
        { content: { text: 'follow up' }, meta: { hamlet: { kind: 'timer' } } },
        { content: { text: 'change detected' }, meta: { hamlet: { kind: 'doorbell', sender: 'watcher' } } },
    ])
    expect(rows.every(row => row.invokedAt !== null)).toBe(true)
    expect(db.recordInputs(main.id, db.claim(main.id)!.events)).toEqual([])
    db.ack(main.id, batch.id)
    expect(db.claim(main.id)).toBeNull()
})

test('agent queries show only inputs of the active turn in delivery order and respect group visibility', async () => {
    const db = hub.hamlet
    const worker = child(main, 'worker'), peer = child(main, 'peer'), offline = child(main, 'offline')
    const group = db.createGroup(main, 'team', [worker.id, peer.id], false).id
    db.addAttachment('pic', peer.id, 'sample.png', 'image/png', 100)
    db.send(peer, { target: { group_id: group }, text: 'shared', images: [{ attachment_id: 'pic', caption: 'photo' }] })
    db.addTimer(worker.id, 1, null, 'timer')
    db.fire(1)
    db.addDoorbell(worker.id, 'bell', 'script')
    db.ring(db.manifest('hub')[0].token, 'bell', 'key')
    const batch = db.claim(worker.id)!
    db.send(main, { target: { agent_id: worker.id }, text: 'next turn', images: [] })
    const native = { message_id: 'u', content: [{ type: 'text', text: 'user steering' }] }
    const service = new HamletService(db, {
        getSession: (id: string) => ({ active: id !== offline.id }),
    } as SyncEngine, {
        hamletCurrentTurn: async (id: string) => id === worker.id ? { turn_id: 't', inputs: [{ batch_id: batch.id }, native] } : null,
    } as RpcGateway)
    const working = { agent_id: worker.id, status: 'working', running: true, processing: [...batch.events, { kind: 'user', ...native }] }
    expect(await service.tool(main, 'agent_list', {})).toMatchObject([
        working, { running: false, status: 'idle', processing: [] }, { running: false, status: 'inactive', processing: [] },
    ])
    expect(await service.tool(main, 'agent_list', { ids: [worker.id, main.id] })).toMatchObject([working])
    expect(await service.tool(worker, 'whoami', {})).toMatchObject({ ...working, parent: { running: false } })
    const peers = await service.tool(peer, 'group_members', { group_id: group }) as {agent_id: string}[]
    expect(peers.find(p => p.agent_id === worker.id)).toMatchObject({
        running: true, processing: [batch.events[1]], hidden_input_count: 4,
    })
    expect(await service.tool(offline, 'agent_list', { ids: [worker.id] })).toEqual([])
    await expect(service.tool(offline, 'group_members', { group_id: group })).rejects.toThrow('Group unavailable')
    db.ack(worker.id, batch.id)
    expect(await service.tool(main, 'agent_list', { ids: [worker.id] })).toMatchObject([{ status: 'unknown', processing: null }])
})

test('only direct parents may intervene, and immediate messages never enter the regular inbox', async () => {
    const a = child(main, 'worker'), peer = child(main, 'peer'), grandchild = child(a, 'grandchild')
    ready(a)
    const team = hub.hamlet.createGroup(main, 'team', [a.id, peer.id], true)
    expect(team.id).toBeTruthy()
    const service = new HamletService(hub.hamlet, { getSession: () => ({ active: true }) } as unknown as SyncEngine, {
        hamletControlTurn: async (_agent: string, _turn: string, batch: unknown) => batch ?? { status: 'interrupt_requested' },
    } as RpcGateway)
    hub.hamlet.addAttachment('ref', main.id, 'ref.png', 'image/png', 12)
    const input = { agent_id: a.id, turn_id: 'one', request_id: 'fix', text: 'correct', images: [{ attachment_id: 'ref' }] }
    for (const caller of [peer, grandchild, a]) {
        await expect(service.tool(caller, 'agent_steer', input)).rejects.toThrow('Direct child required')
    }
    await expect(service.tool(main, 'agent_steer', { ...input, agent_id: grandchild.id })).rejects.toThrow('Direct child required')
    const batch = await service.tool(main, 'agent_steer', input)
    expect(batch).toMatchObject({ events: [{ kind: 'message', sender: main.id, text: 'correct', images: input.images }] })
    expect(await service.tool(main, 'agent_steer', input)).toEqual(batch)
    expect(hub.hamlet.claim(a.id)).toBeNull()
    expect(hub.hamlet.attachment('ref', a.id)?.name).toBe('ref.png')
})
