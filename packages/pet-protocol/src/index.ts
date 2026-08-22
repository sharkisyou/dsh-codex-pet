/**
 * Desktop Pet wire protocol — public contract package.
 *
 * The JSON Schema file under schema/events.schema.json is the source of truth.
 * TypeScript types and constants are generated from that schema by
 * scripts/generate-types.mjs; runtime validation is schema-driven as well.
 */

export const PROTOCOL_PATH = '/v1' as const
export const PROTOCOL_VERSION = 1 as const
/** Alias for consumers that prefer the PET_ prefix. */
export const PET_PROTOCOL_VERSION = PROTOCOL_VERSION

/** Fixed default port for the desktop pet WebSocket server. */
export const DEFAULT_PORT = 3720 as const

/** Default WebSocket URL used by bridge clients when DSH_PET_URL is unset. */
export const DEFAULT_WS_URL = `ws://127.0.0.1:${DEFAULT_PORT}${PROTOCOL_PATH}` as const

/** Composite session identity: agent:sessionId. */
export function createSessionKey(agent: string, sessionId: string): string {
  return `${agent}:${sessionId}`
}

export {
  assertPetEvent,
  isPetEvent,
  isPetEventEnvelope,
  isValidPetEvent,
  parsePetEvent,
  validatePetEvent,
  type PetEventEnvelope,
  type PetEventValidationResult,
} from './validate.js'

export { EVENT_TYPES, protocolSchema, type EventType, type PetEvent } from './generated/protocol.js'
export { protocolSchema as eventsSchema } from './generated/protocol.js'
export { EVENT_TYPES as PET_EVENT_TYPES } from './generated/protocol.js'
export type {
  ActivityState,
  Agent,
  ApprovalEndEvent,
  ApprovalStartEvent,
  DirectoryEntry,
  EventEnvelope,
  HelloEvent,
  PendingKind,
  ProtocolVersion,
  QuestionEndEvent,
  QuestionStartEvent,
  SessionDirectoryEvent,
  SessionErrorEvent,
  SessionId,
  SessionOpenEvent,
  SessionState,
  SessionStatusEvent,
  SessionSyncEvent,
  SnapshotEvent,
  SnapshotSession,
  SubagentEndEvent,
  SubagentStartEvent,
  ToolEndEvent,
  ToolStartEvent,
} from './generated/protocol.js'
