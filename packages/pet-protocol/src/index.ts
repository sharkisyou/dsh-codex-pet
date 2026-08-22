/**
 * Desktop Pet wire protocol — public contract scaffold.
 *
 * The full event set is defined in docs/adr/0002-pet-wire-protocol.md.
 * JSON Schema (schema/events.schema.json) remains the source of truth for
 * generated types; this scaffold exports the constants and a small typed
 * envelope that will be expanded as the protocol lands.
 */

export const PROTOCOL_PATH = '/v1' as const

/** Fixed default port for the desktop pet WebSocket server. */
export const DEFAULT_PORT = 3720 as const

/** Default WebSocket URL used by bridge clients when DSH_PET_URL is unset. */
export const DEFAULT_WS_URL = `ws://127.0.0.1:${DEFAULT_PORT}${PROTOCOL_PATH}` as const

export interface PetEventEnvelope {
  /** Source tool, e.g. "dsh", "codex", or "claude". Open string, not an enum. */
  agent: string
  /** Session id as scoped by the source tool. */
  sessionId: string
  /** Optional event type discriminator; full event set arrives in later tickets. */
  type?: string
  [key: string]: unknown
}

export function createSessionKey(agent: string, sessionId: string): string {
  return `${agent}:${sessionId}`
}

export function isPetEventEnvelope(value: unknown): value is PetEventEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.agent === 'string' && typeof record.sessionId === 'string'
}
