import { hamletTools, type HamletTool, type AgentConfig, type HamletBatch, type HamletTurn } from '@hamlet/protocol/hamlet'
import type { SyncEngine } from '../sync/syncEngine'
import { RpcTargetMissingError, type RpcGateway } from '../sync/rpcGateway'
import type { HamletStore, Agent, AgentCard } from './store'

export class HamletService {
    private readonly waking = new Map<string, Promise<void>>()
    private readonly retryAt = new Map<string, number>()
    private readonly machineJobs = new Set<string>()
    private interval?: ReturnType<typeof setInterval>
    constructor(
        readonly store: HamletStore,
        private readonly engine: SyncEngine,
        private readonly rpc: RpcGateway,
    ) {}
    start() {
        this.store.restoreInitialInputs()
        this.interval = setInterval(() => this.tick(), 2000)
        this.interval.unref()
    }
    stop() {
        clearInterval(this.interval)
    }

    async create(namespace: string, parent: string | null, key: string, config: AgentConfig, timezone?: string) {
        const machine = this.engine.getMachineByNamespace(config.machine_id, namespace)
        if (!machine) throw new Error('Machine unavailable')
        if (!machine.metadata?.capabilities?.includes('hamlet'))
            throw new Error('目标机器的 Runner 不支持托管 Agent。请从 Hub 的「设置 → 设备 → 安装 Hamlet Runner」获取新版并在目标机器安装。')
        const agent = this.store.register(namespace, parent, key, config, timezone)
        await this.wake(agent)
        return this.store.card(agent.id)
    }
    claimInbox(agent: string) {
        const batch = this.store.claim(agent)
        if (batch) this.recordInputs(agent, batch.events)
        return batch
    }
    recordInputs(agent: string, events: HamletBatch['events']) {
        for (const message of this.store.recordInputs(agent, events)) {
            this.engine.handleRealtimeEvent({ type: 'message-received', sessionId: agent, message })
        }
    }
    private wake(agent: Agent) {
        const started = this.waking.get(agent.id)
        if (started) return started
        const work = this.launch(agent).finally(() => this.waking.delete(agent.id))
        this.waking.set(agent.id, work)
        return work
    }
    private async launch(agent: Agent) {
        const machine = this.engine.getMachineByNamespace(agent.machine_id, agent.namespace)
        if (!machine?.active) throw new Error('machine_offline')
        const config = JSON.parse(agent.launch_config) as AgentConfig
        const model = config.model ?? 'gpt-6.2-sol'
        const session =
            this.engine.getSession(agent.id) ??
            this.engine.getOrCreateSession(
                'hamlet:' + agent.id,
                {
                    path: config.directory,
                    host: machine.metadata?.host ?? '',
                    machineId: machine.id,
                    hamletAgent: true,
                    name: agent.name,
                    flavor: 'codex',
                    startedBy: 'runner',
                },
                null,
                agent.namespace,
                model,
                undefined,
                config.reasoning_effort,
                agent.id,
            )
        if (session.active) return
        const nativeId = session.metadata?.codexSessionId
        const result = await this.rpc.spawnSession(
            machine.id,
            nativeId ? session.metadata!.path : config.directory,
            'codex',
            session.model ?? model,
            config.reasoning_effort,
            true,
            nativeId ? 'simple' : config.session_type,
            undefined,
            nativeId,
            undefined,
            'yolo',
            config.service_tier,
            agent.id,
            config.collaboration_mode,
            undefined,
            'remote',
        )
        if (result.type === 'error') throw new Error(result.message)
        if (result.sessionId !== agent.id) throw new Error('Runner returned a different session')
    }
    private tick() {
        this.store.fire(Date.now())
        for (const agent of this.store.pending()) {
            if (
                !this.engine.getMachine(agent.machine_id)?.active ||
                this.engine.getSession(agent.id)?.active ||
                this.waking.has(agent.id) ||
                (this.retryAt.get(agent.id) ?? 0) > Date.now()
            )
                continue
            void this.wake(agent).then(
                () => this.retryAt.delete(agent.id),
                (error) => {
                    this.retryAt.set(agent.id, Date.now() + 30_000)
                    console.error('[Hamlet] Unable to wake', agent.id, String(error))
                },
            )
        }
        const cleanup = this.store.cleanup()
        for (const machine of this.engine.getOnlineMachines()) {
            if (this.machineJobs.has(machine.id) || !this.rpc.hasHamletRunner(machine.id)) continue
            this.machineJobs.add(machine.id)
            void this.reconcile(
                machine.id,
                cleanup.filter((c) => c.machine_id === machine.id),
            )
                .catch((error) => console.error('[Hamlet] Runner reconciliation', machine.id, String(error)))
                .finally(() => this.machineJobs.delete(machine.id))
        }
    }
    private async reconcile(machine: string, cleanup: ReturnType<HamletStore['cleanup']>) {
        const revision = this.store.manifestRevision(machine)
        const states =
            (await this.rpc.hamletDoorbells(machine, revision)) ??
            (await this.rpc.hamletDoorbells(
                machine,
                this.store.manifestRevision(machine),
                this.store.manifest(machine),
            ))!
        for (const s of states) this.store.bellStatus(s.id, s.status, s.error)
        for (const item of cleanup) {
            await this.waking.get(item.agent)?.catch(() => {})
            if ((await this.rpc.stopRunnerSession(machine, item.agent)) === 'still_alive') continue
            if (this.engine.getSession(item.agent)) await this.engine.deleteSession(item.agent)
            this.store.cleaned(item.agent)
        }
    }
    private async describe(actor: Agent, card: AgentCard, full: boolean) {
        const session = this.engine.getSession(card.agent_id)
        if (!session?.active) return { ...card, status: 'inactive', running: false, processing: [] }
        let turn: HamletTurn | null
        try {
            turn = await this.rpc.hamletCurrentTurn(card.agent_id)
        } catch (error) {
            const activeTurn = session.agentState?.steeringActive
            if (error instanceof RpcTargetMissingError && error.code === 'handler-not-registered' && typeof activeTurn === 'boolean') {
                return { ...card, status: activeTurn ? 'working' : 'idle', running: activeTurn,
                    processing: activeTurn ? null : [], detail: 'Runner has not registered live input reporting' }
            }
            return { ...card, status: 'unknown', running: null, processing: null }
        }
        if (!turn) return { ...card, status: 'idle', running: false, processing: [] }
        const processing: (HamletBatch['events'][number] | { kind: 'user'; message_id: string; content: unknown[] })[] = []
        let hidden = 0
        for (const input of turn.inputs) {
            if ('batch_id' in input) {
                const events = this.store.batchEvents(card.agent_id, input.batch_id)
                // A turn may finish and acknowledge its batch during the RPC round trip.
                if (!events.length) return { ...card, status: 'unknown', running: null, processing: null }
                for (const event of events) {
                    if (full || event.sender === actor.id || this.store.received(actor.id, event.seq)) processing.push(event)
                    else hidden++
                }
            } else if (full) {
                processing.push({ kind: 'user', ...input })
            } else hidden++
        }
        return { ...card, status: 'working', running: true, turn_id: turn.turn_id, processing, hidden_input_count: hidden }
    }
    async tool(actor: Agent, name: HamletTool, input: unknown): Promise<unknown> {
        const db = this.store
        switch (name) {
            case 'whoami': {
                const parent = actor.parent_id && db.card(actor.parent_id)
                const [self, parentCard] = await Promise.all([
                    this.describe(actor, db.card(actor.id)!, true),
                    parent ? this.describe(actor, parent, false) : null,
                ])
                return { ...self, parent: parentCard }
            }
            case 'machine_list':
                return this.engine.getMachinesByNamespace(actor.namespace).map((m) => ({
                    machine_id: m.id,
                    name: m.metadata?.displayName || m.metadata?.host || m.id,
                    online: m.active && this.rpc.hasHamletRunner(m.id),
                }))
            case 'agent_create': {
                const { request_id, ...config } = hamletTools.agent_create.parse(input)
                return this.create(actor.namespace, actor.id, request_id, config)
            }
            case 'agent_list':
                return Promise.all(db.children(actor, hamletTools.agent_list.parse(input).ids).map(card => this.describe(actor, card, true)))
            case 'agent_interrupt':
            case 'agent_steer': {
                const { agent_id, turn_id } = hamletTools.agent_interrupt.parse(input)
                if (db.agent(agent_id)?.parent_id !== actor.id) throw new Error('Direct child required')
                if (!this.engine.getSession(agent_id)?.active) return { status: 'inactive' }
                let batch: HamletBatch | undefined
                if (name === 'agent_steer') {
                    const p = hamletTools.agent_steer.parse(input)
                    batch = db.prepareSteer(actor, agent_id, turn_id, p.request_id, p.text, p.images)
                }
                return this.rpc.hamletControlTurn(agent_id, turn_id, batch)
            }
            case 'agent_delete_status':
                return db.pendingDeletions(actor.id)
            case 'agent_delete': {
                const p = hamletTools.agent_delete.parse(input)
                const preview = db.deleteTree(actor, p.agent_id, p.force, p.subtree_version)
                if (!preview.nodes) return preview
                return {
                    ...preview,
                    nodes: preview.nodes.map((n) => {
                        const session = this.engine.getSession(n.agent_id)
                        return { ...n, status: session?.thinking ? 'working' : session?.active ? 'idle' : 'inactive' }
                    }),
                }
            }
            case 'group_create': {
                const p = hamletTools.group_create.parse(input)
                return db.createGroup(actor, p.name, p.members, p.include_self)
            }
            case 'group_update': {
                const p = hamletTools.group_update.parse(input)
                return db.updateGroup(actor, p.group_id, p.add, p.remove)
            }
            case 'group_members':
                return Promise.all(db.members(actor, hamletTools.group_members.parse(input).group_id).map(card =>
                    this.describe(actor, card, card.agent_id === actor.id || db.agent(card.agent_id)?.parent_id === actor.id)))
            case 'group_list':
                return db.groups(actor)
            case 'group_delete':
                db.deleteGroup(actor, hamletTools.group_delete.parse(input).group_id)
                break
            case 'message_to':
                return db.send(actor, hamletTools.message_to.parse(input))
            case 'timer_create': {
                const p = hamletTools.timer_create.parse(input)
                return db.addTimer(
                    actor.id,
                    Date.parse(p.due_at),
                    p.interval_seconds ? p.interval_seconds * 1000 : null,
                    p.text,
                )
            }
            case 'timer_list':
                return db.timers(actor.id)
            case 'timer_delete':
                db.deleteTimer(actor.id, hamletTools.timer_delete.parse(input).id)
                break
            case 'doorbell_create': {
                const p = hamletTools.doorbell_create.parse(input)
                return db.addDoorbell(actor.id, p.name, p.script)
            }
            case 'doorbell_logs': {
                const { id } = hamletTools.doorbell_logs.parse(input)
                if (!db.ownsDoorbell(actor.id, id)) throw new Error('Doorbell unavailable')
                return this.rpc.hamletDoorbellLog(actor.machine_id, id)
            }
            case 'doorbell_list':
                return db.doorbells(actor.id)
            case 'doorbell_delete':
                db.deleteDoorbell(actor.id, hamletTools.doorbell_delete.parse(input).id)
                break
            case 'doorbell_enable': {
                const p = hamletTools.doorbell_enable.parse(input)
                db.setDoorbell(actor.id, p.id, p.enabled)
                break
            }
            case 'machine_exec': {
                if (actor.parent_id !== null) throw new Error('Main agent required')
                const p = hamletTools.machine_exec.parse(input)
                if (!this.engine.getMachineByNamespace(p.machine_id, actor.namespace)?.active || !this.rpc.hasHamletRunner(p.machine_id))
                    throw new Error('machine_offline')
                return this.rpc.hamletExec(p.machine_id, p.command, p.cwd)
            }
        }
        return { ok: true }
    }
}
