/**
 * Composite session identity helpers.
 *
 * The desktop pet keys sessions as `agent:sessionId` so two tools can both
 * have a session named "s1" without colliding.
 */

import type { Agent, SessionId, SessionKey } from './types.js'

export interface SessionRef {
  agent: Agent
  sessionId: SessionId
  key: SessionKey
}

export function createSessionKey(agent: Agent, sessionId: SessionId): SessionKey {
  return `${agent}:${sessionId}`
}

export function parseSessionKey(key: string): SessionRef | null {
  if (typeof key !== 'string' || key === '') return null
  const idx = key.indexOf(':')
  if (idx <= 0 || idx === key.length - 1) return null
  const agent = key.slice(0, idx)
  const sessionId = key.slice(idx + 1)
  if (agent === '' || sessionId === '') return null
  return { agent, sessionId, key }
}

/** Normalize a session entry or ref to the composite key. */
export function sessionKeyOf(
  value: string | { agent?: unknown; sessionId?: unknown; id?: unknown; key?: unknown } | null | undefined,
): SessionKey | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    if (value.includes(':')) return value
    return value
  }
  if (typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.key === 'string' && obj.key !== '') return obj.key
  const agent = typeof obj.agent === 'string' && obj.agent !== '' ? obj.agent : null
  const sessionId = typeof obj.sessionId === 'string' && obj.sessionId !== ''
    ? obj.sessionId
    : typeof obj.id === 'string' && obj.id !== ''
      ? obj.id
      : null
  if (agent !== null && sessionId !== null) return createSessionKey(agent, sessionId)
  if (sessionId !== null) return sessionId
  return null
}

export function sessionRefOf(
  value: unknown,
): { agent: Agent | null; sessionId: SessionId | null; key: SessionKey | null } {
  if (typeof value === 'string') {
    if (value.includes(':')) {
      const parsed = parseSessionKey(value)
      if (parsed !== null) return parsed
    }
    return { agent: null, sessionId: value, key: value }
  }
  if (value === null || typeof value !== 'object') {
    return { agent: null, sessionId: null, key: null }
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.key === 'string' && obj.key !== '') {
    const parsed = parseSessionKey(obj.key)
    if (parsed !== null) return parsed
    return { agent: null, sessionId: obj.key, key: obj.key }
  }
  const agent = typeof obj.agent === 'string' && obj.agent !== '' ? obj.agent : null
  const sessionId = typeof obj.sessionId === 'string' && obj.sessionId !== ''
    ? obj.sessionId
    : typeof obj.id === 'string' && obj.id !== ''
      ? obj.id
      : null
  const key = agent !== null && sessionId !== null ? createSessionKey(agent, sessionId) : sessionId
  return { agent, sessionId, key }
}
