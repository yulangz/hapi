import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent, SyncEventListener, SyncEngine } from '../sync/syncEngine'
import type { SessionEndReason } from '@hapi/protocol'
import type { NotificationChannel, TaskNotification } from './notificationTypes'
import { NotificationHub } from './notificationHub'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class FakeSyncEngine {
    private readonly listeners: Set<SyncEventListener> = new Set()
    private readonly sessions: Map<string, Session> = new Map()
    readonly history = new Map<string, Extract<SyncEvent, { type: 'message-received' }>['message'][]>()
    historyReads = 0

    getRecentMessages(sessionId: string, limit: number) {
        this.historyReads++
        expect(limit).toBeLessThanOrEqual(50)
        return (this.history.get(sessionId) ?? []).slice(-limit)
    }

    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    setSession(session: Session): void {
        this.sessions.set(session.id, session)
    }

    emit(event: SyncEvent): void {
        if (event.type === 'message-received') {
            const messages = this.history.get(event.sessionId) ?? []
            messages.push(event.message)
            this.history.set(event.sessionId, messages)
        }
        for (const listener of this.listeners) {
            listener(event)
        }
    }
}

class StubChannel implements NotificationChannel {
    readonly readySessions: Session[] = []
    readonly permissionSessions: Session[] = []
    readonly taskNotifications: Array<{ session: Session; notification: TaskNotification }> = []
    readonly sessionCompletions: Session[] = []

    async sendReady(session: Session): Promise<void> {
        this.readySessions.push(session)
    }

    async sendPermissionRequest(session: Session): Promise<void> {
        this.permissionSessions.push(session)
    }

    async sendTaskNotification(session: Session, notification: TaskNotification): Promise<void> {
        this.taskNotifications.push({ session, notification })
    }

    async sendSessionCompletion(session: Session): Promise<void> {
        this.sessionCompletions.push(session)
    }
}

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        ...overrides
    }
}

function messageEvent(content: unknown, id = 'message'): Extract<SyncEvent, { type: 'message-received' }> {
    return { type: 'message-received', sessionId: 'session-1', message: {
        id, seq: 1, localId: null, createdAt: Date.now(), content
    } }
}

function goalEvent(status: string | null, threadId = 'root'): Extract<SyncEvent, { type: 'message-received' }> {
    return messageEvent({ role: 'agent', content: { type: 'codex', data: {
        type: status === null ? 'thread_goal_cleared' : 'thread_goal_updated', thread_id: threadId,
        ...(status === null ? {} : { goal: { threadId, status } })
    } } })
}

const readyMessage = () => messageEvent({ role: 'agent', content: { type: 'event', data: { type: 'ready' } } })

describe('Codex Goal ready notifications', () => {
    it('suppresses repeated intermediate completions while the Goal remains active, without a history scan per update', () => {
        const engine = new FakeSyncEngine(), channel = new StubChannel()
        engine.setSession(createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'root' } }))
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], { readyCooldownMs: 0 })
        try {
            engine.emit(goalEvent('active'))
            for (let i = 0; i < 6; i++) engine.emit(readyMessage())
            expect(channel.readySessions).toHaveLength(0)
            expect(engine.historyReads).toBe(0)
        } finally { hub.stop() }
    })

    it.each(['complete', 'paused', 'blocked', 'budgetLimited', 'usageLimited', null])('allows ready once the Goal is %s', (status) => {
        const engine = new FakeSyncEngine(), channel = new StubChannel()
        engine.setSession(createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'root' } }))
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel])
        try {
            engine.emit(goalEvent('active')); engine.emit(readyMessage())
            engine.emit(goalEvent(status))
            // A terminal update arriving after the final ready still notifies.
            expect(channel.readySessions).toHaveLength(1)
            engine.emit(readyMessage())
            expect(channel.readySessions).toHaveLength(1)
        } finally { hub.stop() }
    })

    it('seeds the latest persisted root Goal after a Hub restart and ignores other threads', () => {
        const engine = new FakeSyncEngine(), channel = new StubChannel()
        engine.setSession(createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'root' } }))
        engine.history.set('session-1', [goalEvent('paused').message, goalEvent('active').message, goalEvent('complete', 'child').message])
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], { readyCooldownMs: 0 })
        try {
            engine.emit(readyMessage())
            expect(channel.readySessions).toHaveLength(0)
            expect(engine.historyReads).toBe(1)
            engine.emit(goalEvent('complete', 'child')); engine.emit(readyMessage())
            expect(channel.readySessions).toHaveLength(0)
            expect(engine.historyReads).toBe(1)
        } finally { hub.stop() }
    })

    it('does not retain an old root Goal when the native thread binding changes', () => {
        const engine = new FakeSyncEngine(), channel = new StubChannel()
        engine.setSession(createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'root' } }))
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], { readyCooldownMs: 0 })
        try {
            engine.emit(goalEvent('active')); engine.emit(readyMessage())
            engine.setSession(createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'new-root' } }))
            engine.emit(readyMessage())
            expect(channel.readySessions).toHaveLength(1)
        } finally { hub.stop() }
    })

    it('keeps permission/input notifications enabled during active Goals', async () => {
        const engine = new FakeSyncEngine(), channel = new StubChannel()
        const session = createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'root' },
            agentState: { requests: { question: { tool: 'request_user_input', arguments: {} } } } })
        engine.setSession(session)
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], { permissionDebounceMs: 1 })
        try {
            engine.emit(goalEvent('active')); engine.emit(readyMessage())
            engine.emit({ type: 'session-updated', sessionId: session.id })
            await sleep(15)
            expect(channel.readySessions).toHaveLength(0)
            expect(channel.permissionSessions).toHaveLength(1)
        } finally { hub.stop() }
    })

    it('retains normal ready notifications for Codex sessions without a Goal', () => {
        const engine = new FakeSyncEngine(), channel = new StubChannel()
        engine.setSession(createSession({ metadata: { path: '/project', host: 'test', flavor: 'codex', codexSessionId: 'root' } }))
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel])
        try {
            engine.emit(readyMessage())
            expect(channel.readySessions).toHaveLength(1)
        } finally { hub.stop() }
    })
})

describe('NotificationHub', () => {
    it('debounces permission notifications and triggers when request IDs change', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 5,
            readyCooldownMs: 5
        })

        const firstSession = createSession({
            agentState: {
                requests: {
                    req1: { tool: 'Edit', arguments: {}, createdAt: 1 }
                }
            }
        })

        engine.setSession(firstSession)
        engine.emit({ type: 'session-updated', sessionId: firstSession.id })
        await sleep(25)

        expect(channel.permissionSessions).toHaveLength(1)

        engine.emit({ type: 'session-updated', sessionId: firstSession.id })
        await sleep(25)

        expect(channel.permissionSessions).toHaveLength(1)

        const secondSession = createSession({
            id: firstSession.id,
            namespace: firstSession.namespace,
            agentState: {
                requests: {
                    req2: { tool: 'Read', arguments: {}, createdAt: 2 }
                }
            }
        })

        engine.setSession(secondSession)
        engine.emit({ type: 'session-updated', sessionId: secondSession.id })
        await sleep(25)

        expect(channel.permissionSessions).toHaveLength(2)

        hub.stop()
    })

    it('throttles ready notifications per session', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 20
        })

        const session = createSession()
        engine.setSession(session)

        const readyEvent: SyncEvent = {
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-1',
                seq: 1,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        id: 'event-1',
                        type: 'event',
                        data: { type: 'ready' }
                    }
                }
            }
        }

        engine.emit(readyEvent)
        await sleep(5)
        expect(channel.readySessions).toHaveLength(1)

        engine.emit(readyEvent)
        await sleep(5)
        expect(channel.readySessions).toHaveLength(1)

        await sleep(30)
        engine.emit(readyEvent)
        await sleep(5)
        expect(channel.readySessions).toHaveLength(2)

        hub.stop()
    })

    it('sends task notifications for task_notification system messages', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 20
        })

        const session = createSession()
        engine.setSession(session)

        const taskEvent: SyncEvent = {
            type: 'message-received',
            sessionId: session.id,
            message: {
                id: 'message-task',
                seq: 2,
                localId: null,
                createdAt: 0,
                content: {
                    role: 'agent',
                    content: {
                        type: 'output',
                        data: {
                            type: 'system',
                            subtype: 'task_notification',
                            status: 'completed',
                            summary: 'Commit T4 finished'
                        }
                    }
                }
            }
        }

        engine.emit(taskEvent)
        await sleep(5)

        expect(channel.taskNotifications).toHaveLength(1)
        expect(channel.taskNotifications[0]?.notification).toEqual({
            status: 'completed',
            summary: 'Commit T4 finished'
        })

        hub.stop()
    })

    it('sends session completion only for completed session-ended events', async () => {
        const engine = new FakeSyncEngine()
        const channel = new StubChannel()
        const hub = new NotificationHub(engine as unknown as SyncEngine, [channel], {
            permissionDebounceMs: 1,
            readyCooldownMs: 20
        })

        const completedSession = createSession({ id: 'session-completed', active: false })
        const terminatedSession = createSession({ id: 'session-terminated', active: false })
        engine.setSession(completedSession)
        engine.setSession(terminatedSession)

        engine.emit({
            type: 'session-ended',
            sessionId: completedSession.id,
            reason: 'completed' satisfies SessionEndReason
        })
        engine.emit({
            type: 'session-ended',
            sessionId: terminatedSession.id,
            reason: 'terminated' satisfies SessionEndReason
        })
        await sleep(5)

        expect(channel.sessionCompletions).toHaveLength(1)
        expect(channel.sessionCompletions[0]?.id).toBe(completedSession.id)

        hub.stop()
    })
})
