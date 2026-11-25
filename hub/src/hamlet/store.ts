import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import type { AgentConfig, HamletBatch, ImageRef, OutgoingMessage } from '@hamlet/protocol/hamlet'
import type { z } from 'zod'
import { addImportedMessage } from '../store/messages'
import type { StoredMessage } from '../store/types'
import type { HamletChatSource } from '@hamlet/protocol/hamlet'
import { dailySlot } from './schedule'

export type Agent = {
    id: string
    parent_id: string | null
    namespace: string
    machine_id: string
    name: string
    description: string
    launch_config: string
    token: string
}
export type Doorbell = { id: string; owner: string; name: string; script: string; token: string; directory: string }
type Timer = { id: string; owner: string; due: number; period: number | null; text: string }
type Image = z.output<typeof ImageRef>
export type AgentCard = { agent_id: string; name: string; description: string; title: string | null }
const card = `a.id AS agent_id, a.name, a.description, COALESCE(json_extract(s.metadata,'$.summary.text'), json_extract(s.metadata,'$.name')) AS title`
const cards = 'hamlet_agents a LEFT JOIN sessions s ON s.id=a.id'

export class HamletStore {
    constructor(private readonly db: Database) {}

    agent(id: string) {
        return this.db.query<Agent, [string]>('SELECT * FROM hamlet_agents WHERE id=?').get(id)
    }
    userTimezone(namespace: string) {
        return this.db.query<{ timezone: string | null }, [string]>(
            "SELECT json_extract(launch_config,'$.timezone') AS timezone FROM hamlet_agents WHERE namespace=? AND parent_id IS NULL",
        ).get(namespace)?.timezone ?? undefined
    }
    authenticate(token: string) {
        return this.db.query<Agent, [string]>('SELECT * FROM hamlet_agents WHERE token=?').get(token)
    }
    card(id: string) {
        return this.db
            .query<
                AgentCard,
                [string]
            >(`SELECT ${card} FROM ${cards} WHERE a.id=?`)
            .get(id)
    }

    register(namespace: string, parent: string | null, key: string, config: AgentConfig, timezone?: string): Agent {
        return this.db
            .transaction(() => {
                const existing = this.db
                    .query<
                        Agent,
                        [string, string | null, string]
                    >('SELECT * FROM hamlet_agents WHERE namespace=? AND parent_id IS ? AND request_id=?')
                    .get(namespace, parent, key)
                if (existing) {
                    if (timezone) this.db.run("UPDATE hamlet_agents SET launch_config=json_set(launch_config,'$.timezone',?) WHERE id=?", [timezone, existing.id])
                    return existing
                }
                const { machine_id, name, description, prompt, ...launch } = config
                const id = randomUUID()
                this.db.run(
                    `INSERT INTO hamlet_agents(id,namespace,parent_id,machine_id,request_id,name,description,launch_config,token)
                VALUES(?,?,?,?,?,?,?,?,?)`,
                    [id, namespace, parent, machine_id, key, name, description, JSON.stringify({ ...launch, timezone }), randomUUID()],
                )
                this.enqueue(id, 'initial', id, prompt, [], [id])
                return this.agent(id)!
            })
            .immediate()
    }
    children(actor: Agent, ids?: string[]) {
        return this.db
            .query<AgentCard, [string, number | null, string]>(
                `SELECT ${card} FROM ${cards} WHERE parent_id=? AND (? IS NULL OR a.id IN (SELECT value FROM json_each(?))) ORDER BY a.rowid`,
            )
            .all(actor.id, ids ? 1 : null, JSON.stringify(ids ?? []))
    }
    groups(actor: Agent) {
        return this.db
            .query(
                `SELECT g.id,g.owner,g.name,m.agent IS NOT NULL AS joined FROM hamlet_groups g
            LEFT JOIN hamlet_members m ON g.id=m.group_id AND m.agent=? WHERE g.owner=? OR m.agent IS NOT NULL`,
            )
            .all(actor.id, actor.id)
    }
    private owns(actor: Agent, group: string) {
        return Boolean(this.db.query('SELECT 1 FROM hamlet_groups WHERE id=? AND owner=?').get(group, actor.id))
    }
    private joined(id: string, group: string) {
        return Boolean(this.db.query('SELECT 1 FROM hamlet_members WHERE group_id=? AND agent=?').get(group, id))
    }
    members(actor: Agent, group: string) {
        if (!this.owns(actor, group) && !this.joined(actor.id, group)) throw new Error('Group unavailable')
        return this.db
            .query<AgentCard, [string]>(`SELECT ${card} FROM ${cards} JOIN hamlet_members m ON m.agent=a.id WHERE m.group_id=?`)
            .all(group)
    }
    createGroup(actor: Agent, name: string, members: string[], includeSelf: boolean) {
        return this.db
            .transaction(() => {
                const id = randomUUID()
                this.db.run('INSERT INTO hamlet_groups VALUES(?,?,?)', [id, actor.id, name])
                this.updateGroup(actor, id, includeSelf ? [...members, actor.id] : members, [])
                return { id }
            })
            .immediate()
    }
    updateGroup(actor: Agent, group: string, add: string[], remove: string[]) {
        return this.db.transaction(() => {
            if (!this.owns(actor, group)) throw new Error('Group owner required')
            for (const id of add) {
                if (id !== actor.id && this.agent(id)?.parent_id !== actor.id)
                    throw new Error('Member must be a direct child')
                this.db.run('INSERT OR IGNORE INTO hamlet_members VALUES(?,?)', [group, id])
            }
            for (const id of remove) this.db.run('DELETE FROM hamlet_members WHERE group_id=? AND agent=?', [group, id])
            return this.members(actor, group)
        })()
    }
    deleteGroup(actor: Agent, id: string) {
        if (!this.owns(actor, id)) throw new Error('Group owner required')
        this.db.run('DELETE FROM hamlet_groups WHERE id=?', [id])
    }
    private enqueue(
        source: string,
        kind: string,
        key: string,
        text: string,
        images: Image[],
        targets: string[],
        group: string | null = null,
    ) {
        const inserted = this.db
            .query<{ seq: number }, [string, string, string, string, string, string | null]>(
                `INSERT INTO hamlet_events(source,event_key,kind,text,images,group_id)
            VALUES(?,?,?,?,?,?) ON CONFLICT(source,event_key) DO NOTHING RETURNING seq`,
            )
            .get(source, key, kind, text, JSON.stringify(images), group)
        if (!inserted) return { duplicate: true }
        for (const target of targets) {
            this.db.run('INSERT INTO hamlet_inbox(agent,event) VALUES(?,?)', [target, inserted.seq])
            for (const image of images) this.grant(image.attachment_id, target)
        }
        return { event_id: inserted.seq }
    }
    send(actor: Agent, message: z.output<typeof OutgoingMessage>) {
        return this.db
            .transaction(() => {
                let targets: string[]
                if ('group_id' in message.target) {
                    const group = message.target.group_id
                    if (!this.joined(actor.id, group)) throw new Error('Group membership required')
                    targets = this.db
                        .query<{ agent: string }, [string, string]>(
                            'SELECT agent FROM hamlet_members WHERE group_id=? AND agent<>?',
                        )
                        .all(group, actor.id)
                        .map((m) => m.agent)
                } else {
                    const to = this.agent(message.target.agent_id)
                    if (
                        !to ||
                        !(
                            to.id === actor.parent_id ||
                            to.parent_id === actor.id ||
                            this.db
                                .query(
                                    'SELECT 1 FROM hamlet_members a JOIN hamlet_members b USING(group_id) WHERE a.agent=? AND b.agent=?',
                                )
                                .get(actor.id, to.id)
                        )
                    )
                        throw new Error('Recipient unavailable')
                    targets = [to.id]
                }
                for (const image of message.images) {
                    if (!this.attachment(image.attachment_id, actor.id)?.mime.startsWith('image/'))
                        throw new Error('Image unavailable')
                }
                return this.enqueue(
                    actor.id,
                    'message',
                    message.request_id ?? randomUUID(),
                    message.text,
                    message.images,
                    targets,
                    'group_id' in message.target ? message.target.group_id : null,
                )
            })
            .immediate()
    }
    prepareSteer(sender: Agent, agent: string, turn: string, key: string, text: string, images: Image[]): HamletBatch {
        if (!text.trim() && !images.length) throw new Error('Provide text or images')
        return this.db.transaction(() => {
            const existing = this.db.query<{ event: number }, [string, string, string]>(
                'SELECT event FROM hamlet_steers WHERE agent=? AND turn_id=? AND request_id=?'
            ).get(agent, turn, key)
            let seq = existing?.event
            if (!seq) {
                for (const image of images) {
                    if (!this.attachment(image.attachment_id, sender.id)?.mime.startsWith('image/')) throw new Error('Image unavailable')
                    this.grant(image.attachment_id, agent)
                }
                seq = this.db.query<{ seq: number }, [string, string, string, string]>(
                    "INSERT INTO hamlet_events(source,event_key,kind,text,images) VALUES(?,?,'message',?,?) RETURNING seq"
                ).get(sender.id, randomUUID(), text, JSON.stringify(images))!.seq
                this.db.run('INSERT INTO hamlet_steers VALUES(?,?,?,?)', [seq, agent, turn, key])
            }
            const id = 'hamlet:steer:' + seq
            return { id, events: this.batchEvents(agent, id) }
        }).immediate()
    }
    pending() {
        return this.db
            .query<
                Agent,
                []
            >(`SELECT a.* FROM hamlet_agents a JOIN (SELECT DISTINCT agent FROM hamlet_inbox) i ON i.agent=a.id`)
            .all()
    }
    claim(agent: string): HamletBatch | null {
        if (!this.db.query('SELECT 1 FROM hamlet_inbox WHERE agent=? LIMIT 1').get(agent)) return null
        return this.db
            .transaction(() => {
                const old = this.db
                    .query<
                        { batch: string },
                        [string]
                    >('SELECT batch FROM hamlet_inbox WHERE agent=? AND batch IS NOT NULL LIMIT 1')
                    .get(agent)
                const id = old?.batch ?? 'hamlet:' + randomUUID()
                if (!old) this.db.run('UPDATE hamlet_inbox SET batch=? WHERE agent=? AND batch IS NULL', [id, agent])
                const events = this.batchEvents(agent, id)
                return events.length ? { id, events } : null
            })
            .immediate()
    }
    batchEvents(agent: string, id: string): HamletBatch['events'] {
        const steer = id.startsWith('hamlet:steer:')
        const delivery = steer ? 'hamlet_steers' : 'hamlet_inbox'
        type Event = HamletBatch['events'][number]
        const rows = this.db.query<Omit<Event, 'images'> & { images: string }, [string, string]>(`
            WITH delivered AS (
                SELECT e.*, recipient.parent_id,
                    CASE WHEN e.kind='initial' THEN COALESCE(recipient.parent_id, 'system') ELSE e.source END AS sender
                FROM ${delivery} d JOIN hamlet_events e ON e.seq=d.event
                JOIN hamlet_agents recipient ON recipient.id=d.agent
                WHERE d.agent=?1 AND ${steer ? 'd.event' : 'd.batch'}=?2
            )
            SELECT e.seq, e.kind, e.sender, e.text, e.images, e.created_at, e.group_id, g.name AS group_name,
                COALESCE(a.name, b.name) AS sender_name,
                CASE
                    WHEN e.kind='initial' AND e.parent_id IS NULL THEN '系统'
                    WHEN e.sender=e.parent_id THEN '父节点'
                    WHEN a.parent_id=?1 THEN '直属子节点'
                    WHEN a.id IS NOT NULL THEN '同群成员'
                END AS relation,
                CASE WHEN e.kind='timer' THEN CAST(e.event_key AS INTEGER) END AS due_at
            FROM delivered e
            LEFT JOIN hamlet_agents a ON e.kind IN ('initial','message') AND a.id=e.sender
            LEFT JOIN hamlet_doorbells b ON e.kind='doorbell' AND b.id=e.sender
            LEFT JOIN hamlet_groups g ON g.id=e.group_id
            ORDER BY e.seq
        `).all(agent, steer ? id.slice('hamlet:steer:'.length) : id)
        return rows.map(row => ({ ...row, images: JSON.parse(row.images) as Image[] }))
    }
    received(agent: string, seq: number) {
        return !!this.db.query(`SELECT 1 FROM hamlet_inbox WHERE agent=?1 AND event=?2
            UNION ALL SELECT 1 FROM messages WHERE session_id=?1 AND local_id='hamlet-event:' || ?2 LIMIT 1`).get(agent, seq)
    }
    recordInputs(agent: string, events: HamletBatch['events']) {
        const added: StoredMessage[] = []
        this.db.transaction(() => {
            const now = Date.now()
            for (const event of events) {
                const localId = 'hamlet-event:' + event.seq
                if (this.db.query('SELECT 1 FROM messages WHERE session_id=? AND local_id=?').get(agent, localId)) continue
                const { kind } = event
                const source: HamletChatSource = {
                    kind,
                    sender: event.sender_name ?? (kind === 'message' || kind === 'doorbell' ? event.sender : null),
                    group: event.group_name ?? event.group_id,
                    images: event.images.map(({ attachment_id, caption }) => {
                        const file = this.attachment(attachment_id, agent)!
                        return { id: file.id, name: file.name, mime: file.mime, caption }
                    }),
                }
                // HAMLET's CLI recognizes this as transcript history during reconnect, never as another prompt.
                const content = { role: 'user', content: { type: 'text', text: event.text }, meta: { sentFrom: 'cli', hamlet: source } }
                const at = kind === 'initial' ? event.created_at : now
                added.push(addImportedMessage(this.db, agent, content, localId, at).message)
            }
        })()
        return added
    }
    restoreInitialInputs() {
        // Older Hub versions acknowledged initial prompts without mirroring them into the chat.
        const rows = this.db.query<{ seq: number; agent: string; text: string; created_at: number }, []>(`
            SELECT e.seq,a.id AS agent,e.text,e.created_at FROM hamlet_agents a JOIN sessions s ON s.id=a.id
            JOIN hamlet_events e ON e.source=a.id AND e.event_key=a.id AND e.kind='initial'
            WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id=a.id AND m.local_id='hamlet-event:' || e.seq)
              AND NOT EXISTS (SELECT 1 FROM hamlet_inbox i WHERE i.agent=a.id AND i.event=e.seq)
        `).all()
        for (const row of rows) {
            this.recordInputs(row.agent, [{ ...row, kind: 'initial', sender: row.agent, images: [], group_id: null, due_at: null }])
        }
    }
    ack(agent: string, batch: string) {
        this.db.run('DELETE FROM hamlet_inbox WHERE agent=? AND batch=?', [agent, batch])
    }
    addTimer(owner: string, due: number, period: number | null, text: string) {
        const id = randomUUID()
        this.db.run('INSERT INTO hamlet_timers VALUES(?,?,?,?,?)', [id, owner, due, period, text])
        return { id }
    }
    timers(owner: string) {
        return this.db.query('SELECT id,due,period,text FROM hamlet_timers WHERE owner=? ORDER BY due').all(owner)
    }
    deleteTimer(owner: string, id: string) {
        this.db.run('DELETE FROM hamlet_timers WHERE owner=? AND id=?', [owner, id])
    }
    fire(now: number) {
        const due = this.db.query<Timer, [number]>('SELECT * FROM hamlet_timers WHERE due<=? ORDER BY due').all(now)
        if (!due.length) return
        this.db
            .transaction(() => {
                for (const t of due) {
                    this.enqueue(t.id, 'timer', String(t.due), t.text, [], [t.owner])
                    if (t.period)
                        this.db.run('UPDATE hamlet_timers SET due=? WHERE id=?', [
                            t.due + (1 + Math.floor((now - t.due) / t.period)) * t.period,
                            t.id,
                        ])
                    else this.deleteTimer(t.owner, t.id)
                }
            })
            .immediate()
    }
    /**
     * Queue the daily note-consolidation reminder for every main agent once its
     * local time has passed. A Hub that was down at that time catches up within
     * `graceMinutes`; later than that, the day is skipped rather than interrupting the day.
     */
    remindDream(now: number, schedule: { time: string; timezone: string; graceMinutes: number }, text: string) {
        const { day, at } = dailySlot(now, schedule.time, schedule.timezone)
        if (now < at || now >= at + schedule.graceMinutes * 60_000 || this.dreamDay === day) return
        this.db
            .transaction(() => {
                const roots = this.db.query<{ id: string }, []>('SELECT id FROM hamlet_agents WHERE parent_id IS NULL').all()
                for (const root of roots) this.enqueue('hamlet-dream', 'dream', root.id + ':' + day, text, [], [root.id])
            })
            .immediate()
        this.dreamDay = day
    }
    private dreamDay?: string
    addDoorbell(owner: string, name: string, script: string, maxRings: number | null = null) {
        const id = randomUUID()
        this.db.run('INSERT INTO hamlet_doorbells(id,owner,name,script,token,max_rings) VALUES(?,?,?,?,?,?)', [
            id,
            owner,
            name,
            script,
            randomUUID(),
            maxRings,
        ])
        return { id }
    }
    doorbells(owner: string) {
        return this.db.query('SELECT id,name,enabled,status,rings,max_rings,last_error FROM hamlet_doorbells WHERE owner=?').all(owner)
    }
    setDoorbell(owner: string, id: string, enabled: boolean) {
        // Resuming restarts the count, so a completed one-shot doorbell can be armed again.
        this.db.run(
            'UPDATE hamlet_doorbells SET enabled=?,status=?,last_error=NULL,rings=CASE WHEN ? THEN 0 ELSE rings END WHERE owner=? AND id=?',
            [+enabled, enabled ? 'pending' : 'stopped', +enabled, owner, id],
        )
    }
    deleteDoorbell(owner: string, id: string) {
        this.db.run('DELETE FROM hamlet_doorbells WHERE owner=? AND id=?', [owner, id])
    }
    manifest(machine: string) {
        return this.db
            .query<Doorbell, [string]>(
                `SELECT d.id,d.owner,d.name,d.script,d.token,COALESCE(json_extract(s.metadata,'$.path'), json_extract(a.launch_config,'$.directory')) AS directory
            FROM hamlet_doorbells d JOIN hamlet_agents a ON a.id=d.owner LEFT JOIN sessions s ON s.id=a.id WHERE a.machine_id=? AND d.enabled=1`,
            )
            .all(machine)
    }
    manifestRevision(machine: string) {
        // Scripts and tokens are immutable. A bell's working directory can change when its worktree is created.
        const entries = this.db
            .query(
                `SELECT d.id, COALESCE(json_extract(s.metadata,'$.path'), json_extract(a.launch_config,'$.directory')) AS directory
            FROM hamlet_doorbells d JOIN hamlet_agents a ON a.id=d.owner LEFT JOIN sessions s ON s.id=a.id
            WHERE a.machine_id=? AND d.enabled=1 ORDER BY d.id`,
            )
            .all(machine)
        return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
    }
    ring(token: string, text: string, key: string) {
        return this.db
            .transaction(() => {
                const d = this.db
                    .query<
                        { id: string; owner: string; enabled: number; status: string; rings: number; max_rings: number | null },
                        [string]
                    >('SELECT id,owner,enabled,status,rings,max_rings FROM hamlet_doorbells WHERE token=?')
                    .get(token)
                // A script may still ring between reaching its limit and the Runner stopping it.
                if (d?.status === 'completed') return { completed: true }
                if (!d?.enabled) throw new Error('Doorbell unavailable')
                const last = d.max_rings !== null && d.rings + 1 >= d.max_rings
                const note = last ? `\n\n（这个 doorbell 已触发 ${d.max_rings} 次，达到上限，已自动停止。）` : ''
                const result = this.enqueue(d.id, 'doorbell', key, text + note, [], [d.owner])
                if ('duplicate' in result) return result
                this.db.run(
                    "UPDATE hamlet_doorbells SET rings=rings+1, enabled=CASE WHEN ?1 THEN 0 ELSE enabled END, status=CASE WHEN ?1 THEN 'completed' ELSE status END WHERE id=?2",
                    [+last, d.id],
                )
                return last ? { ...result, completed: true } : result
            })
            .immediate()
    }
    bellStatus(id: string, status: string, error: string | null) {
        this.db.run(
            'UPDATE hamlet_doorbells SET status=?1,last_error=?2 WHERE id=?3 AND enabled=1 AND (status!=?1 OR last_error IS NOT ?2)',
            [status, error, id],
        )
    }
    grant(id: string, agent: string) {
        this.db.run('INSERT OR IGNORE INTO hamlet_attachment_access VALUES(?,?)', [id, agent])
    }
    addAttachment(id: string, owner: string, name: string, mime: string, size: number) {
        this.db.transaction(() => {
            this.db.run('INSERT INTO hamlet_attachments VALUES(?,?,?,?)', [id, name, mime, size])
            this.grant(id, owner)
        })()
    }
    attachment(id: string, agent: string) {
        return this.db
            .query<
                { id: string; name: string; mime: string; size: number },
                [string, string]
            >(`SELECT a.* FROM hamlet_attachments a JOIN hamlet_attachment_access g ON g.attachment=a.id WHERE a.id=? AND g.agent=?`)
            .get(id, agent)
    }
    deleteTree(actor: Agent, id: string, force: boolean, version?: string) {
        return this.db
            .transaction(() => {
                if (this.agent(id)?.parent_id !== actor.id) throw new Error('Direct child required')
                const nodes = this.db
                    .query<
                        {
                            agent_id: string
                            parent_id: string
                            machine_id: string
                            name: string
                            description: string
                            title: string | null
                            active: number | null
                        },
                        [string]
                    >(
                        `WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT a.id FROM hamlet_agents a JOIN tree ON a.parent_id=tree.id)
                 SELECT ${card},a.parent_id,a.machine_id,s.active FROM ${cards} JOIN tree ON tree.id=a.id ORDER BY a.id`,
                    )
                    .all(id)
                const hash = createHash('sha256')
                    .update(JSON.stringify(nodes.map((n) => [n.agent_id, n.parent_id])))
                    .digest('hex')
                if (force ? hash !== version : nodes.length > 1) return { deleted: false, subtree_version: hash, nodes }
                for (const n of nodes)
                    this.db.run('INSERT INTO hamlet_cleanup VALUES(?,?,?)', [n.agent_id, n.machine_id, actor.id])
                this.db.run('DELETE FROM hamlet_agents WHERE id=?', [id])
                return { deleted: true, count: nodes.length }
            })
            .immediate()
    }
    cleanup() {
        return this.db
            .query<{ agent: string; machine_id: string; requested_by: string }, []>('SELECT * FROM hamlet_cleanup')
            .all()
    }
    pendingDeletions(parent: string) {
        return this.db
            .query('SELECT agent AS agent_id, machine_id FROM hamlet_cleanup WHERE requested_by=?')
            .all(parent)
    }
    ownsDoorbell(owner: string, id: string) {
        return Boolean(this.db.query('SELECT 1 FROM hamlet_doorbells WHERE owner=? AND id=?').get(owner, id))
    }
    cleaned(id: string) {
        this.db.run('DELETE FROM hamlet_cleanup WHERE agent=?', [id])
    }
}
