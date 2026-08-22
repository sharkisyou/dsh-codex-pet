/**
 * Multi-session aggregation pure logic.
 *
 * The original plugin merged host activities with client session summaries,
 * keyed only by session id. In the desktop pet the identity is the composite
 * `(agent, sessionId)` key, so different tools can use the same session id
 * without colliding.
 */

import { createSessionKey, parseSessionKey, sessionRefOf, type SessionRef } from './session.js'
import { toActivityState, TRAY_PRIORITY } from './activity.js'
import type { PendingKind, PetActivityState, PetBubbleKey } from './types.js'

export type LegacySessionState = 'idle' | 'working' | 'waiting' | 'failed' | 'ready'
export type MultiSessionState = LegacySessionState | PetActivityState

export interface SessionSummary {
  id?: string
  sessionId?: string
  agent?: string
  title?: string
  displayTitle?: string
  parentId?: string
  origin?: string
  pendingInteraction?: PendingKind | string
  completed?: boolean
  running?: boolean
  updatedAt?: number
  [key: string]: unknown
}

export interface HostActivity {
  sessionId?: string
  id?: string
  agent?: string
  state?: MultiSessionState
  bubbleKey?: PetBubbleKey | string | null
  bubbleParams?: Record<string, unknown> | null
  pendingKind?: PendingKind | null
  lastEventAt?: number
  acknowledged?: boolean
  [key: string]: unknown
}

export interface MergedSession {
  agent: string | null
  sessionId: string
  key: string
  state: MultiSessionState
  activityState: PetActivityState
  bubbleKey: PetBubbleKey | string | null
  bubbleParams: Record<string, unknown> | null
  pendingKind: PendingKind | null
  lastEventAt: number
  acknowledged: boolean
  active: boolean
  reminder: boolean
  title?: string
  current?: boolean
}

export interface MergeSessionOptions {
  sessionId?: string
  id?: string
  agent?: string
  key?: string
  stateStyle?: 'legacy' | 'protocol'
  hostActivity?: HostActivity | null
  summary?: SessionSummary | null
  currentSession?: string | { agent?: string; sessionId?: string; id?: string; key?: string } | null
}

export function statusKeyFor(
  state: string,
  hostKey: string | null | undefined,
  hostParams: Record<string, unknown> | null | undefined,
  pendingKind: string | null | undefined,
): { bubbleKey: string; bubbleParams: Record<string, unknown> | null } {
  switch (state) {
    case 'waiting':
      if (pendingKind === 'approval') return { bubbleKey: 'waitingApproval', bubbleParams: null }
      if (pendingKind === 'question') return { bubbleKey: 'waitingAnswer', bubbleParams: null }
      if (pendingKind === 'plan-review') return { bubbleKey: 'planReview', bubbleParams: null }
      return { bubbleKey: hostKey || 'waitingInput', bubbleParams: hostParams || null }
    case 'failed':
    case 'blocked':
      return { bubbleKey: 'failed', bubbleParams: null }
    case 'ready':
      return { bubbleKey: 'ready', bubbleParams: null }
    case 'working':
    case 'running':
      return { bubbleKey: hostKey || 'thinking', bubbleParams: hostParams || null }
    case 'idle':
    default:
      return { bubbleKey: hostKey || 'idle', bubbleParams: hostParams || null }
  }
}

export function entryIdOf(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  if (typeof obj.id === 'string' && obj.id !== '') return obj.id
  if (typeof obj.sessionId === 'string' && obj.sessionId !== '') return obj.sessionId
  if (typeof obj.key === 'string' && obj.key !== '') {
    const parsed = parseSessionKey(obj.key)
    if (parsed !== null) return parsed.sessionId
  }
  return null
}

export function isTopLevelSession(entry: unknown): boolean {
  return entry !== null && typeof entry === 'object' &&
    !(entry as Record<string, unknown>).parentId &&
    (entry as Record<string, unknown>).origin !== 'subagent'
}

function currentMatches(
  current: MergeSessionOptions['currentSession'],
  agent: string | null,
  sessionId: string,
  key: string,
): boolean {
  if (current === null || current === undefined) return false
  if (typeof current === 'string') return current === sessionId || current === key
  const ref = sessionRefOf(current)
  return ref.key !== null && (ref.key === key || (ref.agent === null && ref.sessionId === sessionId))
}

function isBlockingState(state: string): boolean {
  return state === 'failed' || state === 'blocked'
}

function prefersProtocol(
  host: HostActivity | null | undefined,
  state: string | null | undefined,
  hasAgent: boolean,
): boolean {
  // When a composite (agent, sessionId) identity is explicitly present, use the
  // protocol-facing activity vocabulary.
  if (hasAgent) return true
  if (host && (host.state === 'running' || host.state === 'blocked' || host.state === 'ready')) return true
  if (state === 'running' || state === 'blocked' || state === 'ready') return true
  return false
}

export function mergeSession(options: MergeSessionOptions): MergedSession {
  const host = options.hostActivity !== null && typeof options.hostActivity === 'object'
    ? options.hostActivity
    : null
  const summary = options.summary !== null && typeof options.summary === 'object'
    ? options.summary
    : null

  const keyRef = typeof options.key === 'string' && options.key !== ''
    ? parseSessionKey(options.key)
    : host && typeof (host as Record<string, unknown>).key === 'string' && (host as Record<string, unknown>).key !== ''
      ? parseSessionKey((host as Record<string, unknown>).key as string)
      : summary && typeof (summary as Record<string, unknown>).key === 'string' && (summary as Record<string, unknown>).key !== ''
        ? parseSessionKey((summary as Record<string, unknown>).key as string)
        : null
  const agent = options.agent
    ?? keyRef?.agent
    ?? (host && typeof host.agent === 'string' && host.agent !== '' ? host.agent : null)
    ?? (summary && typeof summary.agent === 'string' && summary.agent !== '' ? summary.agent : null)
    ?? null
  const sessionId = options.sessionId
    ?? options.id
    ?? keyRef?.sessionId
    ?? (host && typeof host.sessionId === 'string' && host.sessionId !== '' ? host.sessionId : null)
    ?? (host && typeof host.id === 'string' && host.id !== '' ? host.id : null)
    ?? (summary && typeof summary.sessionId === 'string' && summary.sessionId !== '' ? summary.sessionId : null)
    ?? (summary && typeof summary.id === 'string' && summary.id !== '' ? summary.id : null)
    ?? ''

  const key = agent !== null && sessionId !== '' ? createSessionKey(agent, sessionId) : sessionId

  let state: MultiSessionState = host && typeof host.state === 'string' ? host.state : 'idle'
  let bubbleKey: PetBubbleKey | string | null = host && typeof host.bubbleKey === 'string' ? host.bubbleKey : null
  let bubbleParams: Record<string, unknown> | null = host && host.bubbleParams !== null && typeof host.bubbleParams === 'object'
    ? host.bubbleParams
    : null
  let pendingKind: PendingKind | null = host && (host.pendingKind as PendingKind | null) ? host.pendingKind as PendingKind : null
  let lastEventAt = host && typeof host.lastEventAt === 'number' ? host.lastEventAt : 0
  let acknowledged = host ? host.acknowledged === true : false

  if (summary !== null) {
    if (summary.pendingInteraction) {
      state = 'waiting'
      pendingKind = summary.pendingInteraction as PendingKind
      const keyed = statusKeyFor('waiting', null, null, pendingKind)
      bubbleKey = keyed.bubbleKey
      bubbleParams = keyed.bubbleParams
    }
    if (summary.completed === true && state !== 'waiting' && !isBlockingState(state)) {
      state = 'ready'
      bubbleKey = 'ready'
      bubbleParams = null
    }
    if (summary.running === true && state !== 'waiting' && !isBlockingState(state)) {
      const protocol = options.stateStyle === 'protocol'
        ? true
        : options.stateStyle === 'legacy'
          ? false
          : prefersProtocol(host, typeof state === 'string' ? state : undefined, agent !== null)
      state = protocol ? 'running' : 'working'
      if (host && typeof host.bubbleKey === 'string' && host.bubbleKey) {
        bubbleKey = host.bubbleKey
        bubbleParams = host.bubbleParams || null
      } else {
        bubbleKey = 'thinking'
        bubbleParams = null
      }
    }
    if (typeof summary.updatedAt === 'number') {
      lastEventAt = Math.max(lastEventAt, summary.updatedAt)
    }
  }

  const active = state !== 'idle'
  const reminder = !(isBlockingState(state) && acknowledged && !currentMatches(options.currentSession, agent, sessionId, key))

  return {
    agent,
    sessionId,
    key,
    state,
    activityState: toActivityState(state),
    bubbleKey,
    bubbleParams,
    pendingKind,
    lastEventAt,
    acknowledged,
    active,
    reminder,
  }
}

function entryAgent(entry: unknown): string | null {
  if (entry === null || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  if (typeof obj.agent === 'string' && obj.agent !== '') return obj.agent
  if (typeof obj.key === 'string' && obj.key !== '') {
    const parsed = parseSessionKey(obj.key)
    if (parsed !== null) return parsed.agent
  }
  return null
}

function buildItems(
  sessions: unknown,
  activities: unknown,
  currentSession: MergeSessionOptions['currentSession'],
  includeAcknowledgedReminder: boolean,
): MergedSession[] & { title?: string; current?: boolean }[] {
  const byKey = new Map<string, HostActivity>()
  const bySessionId = new Map<string, HostActivity[]>()
  if (Array.isArray(activities)) {
    for (const activity of activities) {
      if (activity === null || typeof activity !== 'object') continue
      const obj = activity as HostActivity
      const explicitKey = typeof obj.key === 'string' && obj.key !== '' ? parseSessionKey(obj.key) : null
      const sid = typeof obj.sessionId === 'string' && obj.sessionId !== ''
        ? obj.sessionId
        : typeof obj.id === 'string' && obj.id !== ''
          ? obj.id
          : explicitKey?.sessionId ?? null
      if (sid === null) continue
      const agent = typeof obj.agent === 'string' && obj.agent !== ''
        ? obj.agent
        : explicitKey?.agent ?? null
      const key = agent !== null ? createSessionKey(agent, sid) : sid
      byKey.set(key, obj)
      const list = bySessionId.get(sid)
      if (list === undefined) bySessionId.set(sid, [obj])
      else list.push(obj)
    }
  }

  function resolveAgent(entry: unknown, id: string): string | null {
    const direct = entryAgent(entry)
    if (direct !== null) return direct
    const candidates = bySessionId.get(id)
    if (candidates !== undefined && candidates.length === 1) {
      const only = candidates[0]
      if (typeof only.agent === 'string' && only.agent !== '') return only.agent
    }
    return null
  }

  const items: Array<MergedSession & { title: string; current: boolean }> = []
  if (Array.isArray(sessions)) {
    for (const entry of sessions) {
      if (!isTopLevelSession(entry)) continue
      const id = entryIdOf(entry)
      if (id === null) continue
      const agent = resolveAgent(entry, id)
      const key = agent !== null ? createSessionKey(agent, id) : id
      let hostActivity = byKey.get(key) || null
      if (hostActivity === null) {
        const candidates = bySessionId.get(id) ?? []
        if (candidates.length > 0) {
          const matching = candidates.filter((a) =>
            a.agent === agent ||
            (a.agent === undefined || a.agent === null) && agent === null ||
            (a.agent === undefined || a.agent === null) && candidates.length === 1,
          )
          if (matching.length === 1) hostActivity = matching[0]
          else if (matching.length > 1) {
            const exact = matching.find((a) => a.agent === agent)
            if (exact !== undefined) hostActivity = exact
          }
        }
      }
      const merged = mergeSession({
        agent: agent ?? undefined,
        sessionId: id,
        hostActivity,
        summary: entry as SessionSummary,
        currentSession,
      })
      if (!merged.active) continue
      if (includeAcknowledgedReminder && !merged.reminder) continue
      const obj = entry as Record<string, unknown>
      const title = typeof obj.displayTitle === 'string' && obj.displayTitle !== ''
        ? obj.displayTitle
        : typeof obj.title === 'string' && obj.title !== ''
          ? obj.title
          : id
      const current = currentMatches(currentSession, agent, id, key)
      items.push({ ...merged, title, current })
    }
  }

  items.sort((a, b) => {
    const pa = TRAY_PRIORITY[a.state as string] ?? TRAY_PRIORITY.idle
    const pb = TRAY_PRIORITY[b.state as string] ?? TRAY_PRIORITY.idle
    if (pa !== pb) return pa - pb
    return (b.lastEventAt || 0) - (a.lastEventAt || 0)
  })
  return items
}

export interface BuildTrayOptions {
  sessions?: unknown
  activities?: unknown
  currentSession?: MergeSessionOptions['currentSession']
}

export function buildTray({ sessions, activities, currentSession }: BuildTrayOptions): Array<MergedSession & { title: string; current: boolean }> {
  return buildItems(sessions, activities, currentSession, true) as Array<MergedSession & { title: string; current: boolean }>
}

export function buildAllActive({ sessions, activities }: Omit<BuildTrayOptions, 'currentSession'>): Array<MergedSession & { title: string; current: boolean }> {
  return buildItems(sessions, activities, null, false) as Array<MergedSession & { title: string; current: boolean }>
}

export function shouldAutoOpen(
  activeItems: Array<{ sessionId?: string; key?: string; agent?: string }>,
  currentSession: string | { agent?: string; sessionId?: string; id?: string; key?: string } | null,
): boolean {
  if (!Array.isArray(activeItems) || activeItems.length === 0) return false
  if (activeItems.length >= 2) return true
  const item = activeItems[0]
  if (typeof currentSession === 'string') {
    return item.sessionId !== currentSession && item.key !== currentSession
  }
  if (currentSession === null || currentSession === undefined) return true
  const ref = sessionRefOf(currentSession)
  if (ref.key !== null) {
    if (item.key !== undefined && item.key !== null) return item.key !== ref.key
    return item.sessionId !== ref.sessionId
  }
  return true
}

export function pickTop<T>(activeItems: T[] | null | undefined): T | null {
  return Array.isArray(activeItems) && activeItems.length > 0 ? activeItems[0] : null
}

/** Re-exported for callers that want the composite key. */
export { createSessionKey }
export type { SessionRef }

/** Re-exported for callers that expect the original module surface. */
export { STATE_PRIORITY } from './activity.js'
