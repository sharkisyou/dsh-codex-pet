/**
 * In-memory multi-session tracker for the desktop pet.
 *
 * This is the composite-key-aware counterpart of the original plugin's host
 * routing: it keeps one state machine per `(agent, sessionId)` pair, accepts
 * wire-protocol events (or legacy machine events), and produces the activity
 * list for the tray/renderer.
 */

import {
  createPetStateMachine,
  type PetStateMachine,
  type PetStateMachineEvent,
  type PetStateMachineResult,
} from './state-machine.js'
import { createSessionKey, parseSessionKey, type SessionRef } from './session.js'
import { toActivityState } from './activity.js'
import { statusKeyFor } from './multi-session.js'
import type { PendingKind, PetActivityState } from './types.js'

export interface SessionStoreEvent {
  agent?: string
  sessionId?: string
  id?: string
  key?: string
  type?: string
  kind?: string
  status?: string
  name?: string
  isQuestion?: boolean
  ts?: number
  childSessionId?: string
  sessionIds?: string[]
  sessions?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export interface SessionStoreActivity {
  agent: string | null
  sessionId: string
  key: string
  state: string
  activityState: PetActivityState
  bubbleKey: string
  bubbleParams: Record<string, unknown> | null
  pendingKind: PendingKind | null
  lastEventAt: number
  acknowledged: boolean
  active: boolean
  reminder: boolean
  title?: string
}

export interface SessionStoreOptions {
  /** Use the protocol-facing state names (running/blocked) in returned activities. */
  stateStyle?: 'legacy' | 'protocol'
}

export interface SnapshotSessionInput {
  sessionId: string
  title?: string
  state?: string
  pendingKind?: PendingKind | string
  lastEventAt?: number
  acknowledged?: boolean
}

export interface SnapshotSessionOutput {
  sessionId: string
  title?: string
  state: string
  pendingKind: PendingKind | null
  lastEventAt: number
  acknowledged: boolean
}

export interface PetSessionTracker {
  handle(event: SessionStoreEvent): PetStateMachineResult | null
  apply(event: SessionStoreEvent): PetStateMachineResult | null
  activities(): SessionStoreActivity[]
  listActivities(): SessionStoreActivity[]
  sync(agent: string, sessionIds: readonly string[]): void
  syncSession(agent: string, sessionIds: readonly string[]): void
  markAcknowledged(agent: string, sessionId: string): void
  resetAcknowledged(): void
  setTitle(agent: string, sessionId: string, title: string): void
  get(agent: string, sessionId: string): SessionStoreActivity | null
  remove(agent: string, sessionId: string): void
  clear(): void
  applySnapshot(agent: string, sessions: readonly SnapshotSessionInput[]): void
  exportSnapshot(agent: string): SnapshotSessionOutput[]
}

interface SnapshotOverride {
  state: string
  pendingKind: PendingKind | null
  lastEventAt: number
  acknowledged: boolean
  bubbleKey: string | null
  bubbleParams: Record<string, unknown> | null
}

function identityOf(event: SessionStoreEvent): { agent: string | null; sessionId: string; key: string } {
  const explicitKey = typeof event.key === 'string' && event.key !== '' ? parseSessionKey(event.key) : null
  const agent = typeof event.agent === 'string' && event.agent !== ''
    ? event.agent
    : explicitKey?.agent ?? null
  const sessionId = typeof event.sessionId === 'string' && event.sessionId !== ''
    ? event.sessionId
    : typeof event.id === 'string' && event.id !== ''
      ? event.id
      : explicitKey?.sessionId ?? ''
  const key = agent !== null && sessionId !== '' ? createSessionKey(agent, sessionId) : sessionId
  return { agent, sessionId, key }
}

export function createPetSessionStore(options: SessionStoreOptions = {}): PetSessionTracker {
  const machines = new Map<string, PetStateMachine>()
  const lastEventAt = new Map<string, number>()
  const pendingKinds = new Map<string, PendingKind | null>()
  const approvalCounts = new Map<string, number>()
  const acknowledged = new Set<string>()
  const titles = new Map<string, string>()
  const snapshotOverrides = new Map<string, SnapshotOverride>()

  const stateStyle = options.stateStyle ?? 'protocol'

  function machineFor(agent: string | null, sessionId: string, key: string): PetStateMachine {
    let machine = machines.get(key)
    if (machine === undefined) {
      machine = createPetStateMachine({
        stateStyle,
        agent: agent ?? undefined,
        sessionId,
      })
      machines.set(key, machine)
    }
    return machine
  }

  function toMachineEvent(event: SessionStoreEvent, ts: number): PetStateMachineEvent | null {
    const kind = event.type ?? event.kind
    if (typeof kind !== 'string' || kind === '') return null
    switch (kind) {
      case 'session/status':
        return { kind: 'agent-status', ts, status: event.status === 'running' ? 'running' : 'idle' }
      case 'session/done':
        return { kind: 'done', ts }
      case 'session/error':
      case 'agent/error':
        return { kind: 'error', ts }
      case 'tool/start':
        return { kind: 'tool-start', ts, name: typeof event.name === 'string' ? event.name : '', isQuestion: event.isQuestion === true }
      case 'tool/end':
        return { kind: 'tool-end', ts }
      case 'approval/start':
        return { kind: 'approval-start', ts }
      case 'approval/end':
        return { kind: 'approval-end', ts }
      case 'question/start':
        return { kind: 'tool-start', ts, name: 'question', isQuestion: true }
      case 'question/end':
        return { kind: 'tool-end', ts }
      case 'subagent/start':
        return { kind: 'subagent-start', ts }
      case 'subagent/end':
        return { kind: 'subagent-end', ts }
      case 'agent-status':
      case 'tool-start':
      case 'tool-end':
      case 'approval-start':
      case 'approval-end':
      case 'subagent-start':
      case 'subagent-end':
      case 'error':
      case 'tick':
        return { kind, ts, status: event.status, name: event.name, isQuestion: event.isQuestion }
      default:
        return null
    }
  }

  function makeActivity(agent: string | null, sessionId: string, key: string): SessionStoreActivity | null {
    const machine = machines.get(key)
    if (machine === undefined) return null
    const override = snapshotOverrides.get(key)
    if (override !== undefined) {
      const state = override.state
      const activityState = toActivityState(state)
      const active = state !== 'idle'
      const keyed = statusKeyFor(state, override.bubbleKey, override.bubbleParams, override.pendingKind)
      const currentAck = acknowledged.has(key)
      return {
        agent,
        sessionId,
        key,
        state,
        activityState,
        bubbleKey: keyed.bubbleKey,
        bubbleParams: keyed.bubbleParams,
        pendingKind: override.pendingKind,
        lastEventAt: override.lastEventAt,
        acknowledged: currentAck,
        active,
        reminder: !((state === 'failed' || state === 'blocked' || (state as string) === 'ready') && currentAck),
        title: titles.get(key),
      }
    }
    const ts = Date.now()
    const result = machine.apply({ kind: 'tick', ts })
    const pendingKind = pendingKinds.get(key) ?? null
    const state = result.state
    const activityState = toActivityState(state)
    const active = state !== 'idle'
    const currentAck = acknowledged.has(key)
    return {
      agent,
      sessionId,
      key,
      state,
      activityState,
      bubbleKey: result.bubbleKey,
      bubbleParams: result.bubbleParams,
      pendingKind,
      lastEventAt: lastEventAt.get(key) ?? 0,
      acknowledged: currentAck,
      active,
      reminder: !((state === 'failed' || state === 'blocked' || (state as string) === 'ready') && currentAck),
      title: titles.get(key),
    }
  }

  function applySnapshot(agent: string, sessions: readonly SnapshotSessionInput[]): void {
    if (typeof agent !== 'string' || agent === '' || !Array.isArray(sessions)) return
    for (const entry of sessions) {
      if (entry === null || typeof entry !== 'object') continue
      const sid = typeof entry.sessionId === 'string' && entry.sessionId !== ''
        ? entry.sessionId
        : null
      if (sid === null) continue
      const key = createSessionKey(agent, sid)
      machineFor(agent, sid, key)
      const state = typeof entry.state === 'string' && entry.state !== '' ? entry.state : 'idle'
      const pendingKind = typeof entry.pendingKind === 'string' && entry.pendingKind !== ''
        ? entry.pendingKind as PendingKind
        : null
      const lastEventAt = typeof entry.lastEventAt === 'number' && entry.lastEventAt > 0 ? entry.lastEventAt : 0
      const ack = entry.acknowledged === true
      snapshotOverrides.set(key, {
        state,
        pendingKind,
        lastEventAt,
        acknowledged: ack,
        bubbleKey: null,
        bubbleParams: null,
      })
      if (typeof entry.title === 'string' && entry.title !== '') {
        titles.set(key, entry.title)
      }
      if (typeof entry.acknowledged === 'boolean') {
        if (ack) acknowledged.add(key)
        else acknowledged.delete(key)
      }
    }
  }

  function exportSnapshot(agent: string): SnapshotSessionOutput[] {
    const output: SnapshotSessionOutput[] = []
    const prefix = `${agent}:`
    for (const key of machines.keys()) {
      if (!key.startsWith(prefix)) continue
      const sid = key.slice(prefix.length)
      if (sid === '') continue
      const activity = makeActivity(agent, sid, key)
      if (activity === null) continue
      output.push({
        sessionId: sid,
        title: activity.title,
        state: activity.state,
        pendingKind: activity.pendingKind,
        lastEventAt: activity.lastEventAt,
        acknowledged: activity.acknowledged,
      })
    }
    output.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    return output
  }

  function handle(event: SessionStoreEvent): PetStateMachineResult | null {
    const { agent, sessionId, key } = identityOf(event)
    const ts = typeof event.ts === 'number' ? event.ts : Date.now()
    const kind = event.type ?? event.kind
    if (kind === 'session/sync') {
      if (agent !== null && Array.isArray(event.sessionIds)) {
        sync(agent, event.sessionIds)
      }
      return null
    }
    if (kind === 'session/directory') {
      if (agent !== null && Array.isArray(event.sessions)) {
        for (const entry of event.sessions) {
          if (entry === null || typeof entry !== 'object') continue
          const sid = typeof entry.sessionId === 'string' && entry.sessionId !== '' ? entry.sessionId : null
          const title = typeof entry.title === 'string' ? entry.title : undefined
          if (sid !== null && title !== undefined) titles.set(createSessionKey(agent, sid), title)
        }
      }
      return null
    }
    if (kind === 'session/current') {
      // The bridge reports the GUI's currently viewed session: viewing a
      // completed/blocked session acknowledges it (clears the tray reminder).
      if (agent !== null && sessionId !== '') {
        acknowledged.add(createSessionKey(agent, sessionId))
      }
      return null
    }
    if (kind === 'snapshot') {
      if (agent !== null && Array.isArray(event.sessions)) {
        applySnapshot(agent, event.sessions as unknown as SnapshotSessionInput[])
      }
      return null
    }
    if (sessionId === '') return null
    const machineEvent = toMachineEvent(event, ts)
    if (machineEvent === null) return null
    // Live events supersede a replayed snapshot for this session.
    snapshotOverrides.delete(key)
    // Any real activity makes a previously acknowledged blocked session active again.
    acknowledged.delete(key)
    if (kind === 'approval/start') {
      approvalCounts.set(key, (approvalCounts.get(key) ?? 0) + 1)
      pendingKinds.set(key, 'approval')
    } else if (kind === 'approval/end') {
      const next = (approvalCounts.get(key) ?? 1) - 1
      if (next <= 0) {
        approvalCounts.delete(key)
        if (pendingKinds.get(key) === 'approval') pendingKinds.delete(key)
      } else {
        approvalCounts.set(key, next)
      }
    } else if (kind === 'question/start') {
      pendingKinds.set(key, 'question')
    } else if (kind === 'question/end') {
      pendingKinds.delete(key)
    }
    // Session status is a real activity; even the transition to idle should be tracked.
    lastEventAt.set(key, ts)
    const machine = machineFor(agent, sessionId, key)
    return machine.apply(machineEvent)
  }

  function sync(agent: string, sessionIds: readonly string[]): void {
    const keep = new Set(sessionIds.map((sid) => createSessionKey(agent, sid)))
    for (const key of machines.keys()) {
      const ref = key.startsWith(`${agent}:`) ? key.slice(agent.length + 1) : key
      if (!keep.has(key) && ref !== '' && key.startsWith(`${agent}:`)) {
        machines.delete(key)
        lastEventAt.delete(key)
        pendingKinds.delete(key)
        approvalCounts.delete(key)
        acknowledged.delete(key)
        titles.delete(key)
        snapshotOverrides.delete(key)
      }
    }
  }

  function activities(): SessionStoreActivity[] {
    const list: SessionStoreActivity[] = []
    for (const [key] of machines) {
      const ref = (() => {
        const parsed = key.includes(':') ? key.split(/:(.*)/s) : null
        if (parsed && parsed.length >= 2) return { agent: parsed[0], sessionId: parsed[1] }
        return { agent: null, sessionId: key }
      })()
      const activity = makeActivity(ref.agent, ref.sessionId, key)
      if (activity !== null && activity.active) list.push(activity)
    }
    const priority: Record<string, number> = { waiting: 4, blocked: 3, ready: 2, running: 1, idle: 0, failed: 3, working: 1 }
    list.sort((a, b) => {
      const pa = priority[a.state] ?? 0
      const pb = priority[b.state] ?? 0
      if (pa !== pb) return pb - pa
      return (b.lastEventAt || 0) - (a.lastEventAt || 0)
    })
    return list
  }

  const tracker: PetSessionTracker = {
    handle,
    apply: handle,
    activities,
    listActivities: activities,
    sync,
    syncSession: sync,
    markAcknowledged(agent, sessionId) {
      acknowledged.add(createSessionKey(agent, sessionId))
    },
    resetAcknowledged() {
      acknowledged.clear()
    },
    setTitle(agent, sessionId, title) {
      titles.set(createSessionKey(agent, sessionId), title)
    },
    get(agent, sessionId) {
      const key = createSessionKey(agent, sessionId)
      return makeActivity(agent, sessionId, key)
    },
    remove(agent, sessionId) {
      const key = createSessionKey(agent, sessionId)
      machines.delete(key)
      lastEventAt.delete(key)
      pendingKinds.delete(key)
      approvalCounts.delete(key)
      acknowledged.delete(key)
      titles.delete(key)
      snapshotOverrides.delete(key)
    },
    clear() {
      machines.clear()
      lastEventAt.clear()
      pendingKinds.clear()
      approvalCounts.clear()
      acknowledged.clear()
      titles.clear()
      snapshotOverrides.clear()
    },
    applySnapshot,
    exportSnapshot,
  }
  // Make the class-style alias work with `instanceof` as well.
  Object.setPrototypeOf(tracker, createPetSessionStore.prototype)
  return tracker
}

/** Alias names that callers may find more descriptive. */
export const createPetSessionManager = createPetSessionStore
export const createMultiSessionTracker = createPetSessionStore

/**
 * Class-style alias. Because the underlying tracker is a plain factory, this
 * can be used both as `PetSessionTracker.create(...)` and with `new` for
 * callers that prefer a class-like API.
 */
export interface PetSessionTrackerConstructor {
  (options?: SessionStoreOptions): PetSessionTracker
  new (options?: SessionStoreOptions): PetSessionTracker
}

export const PetSessionTracker = createPetSessionStore as unknown as PetSessionTrackerConstructor

export type { SessionRef }
