/**
 * Desktop Pet pure core.
 *
 * This package contains the shared, side-effect-free logic used by the desktop
 * pet application: pet-format parsing, per-session state machines,
 * multi-session aggregation with (agent, sessionId) composite keys, animation
 * frame selection, image dimension helpers, and misc utility functions.
 */

// Activity vocabulary and priority helpers.
export {
  ACTIVITY_PRIORITY,
  STATE_PRIORITY,
  TRAY_PRIORITY,
  priorityOf,
  selectDisplayState,
  toActivityState,
} from './activity.js'
export type {
  Agent,
  PendingKind,
  PetActivityState,
  PetBubbleKey,
  PetMachineState,
  SessionId,
  SessionKey,
} from './types.js'

// Composite session identity.
export {
  createSessionKey,
  parseSessionKey,
  sessionKeyOf,
  sessionRefOf,
} from './session.js'
export type { SessionRef } from './session.js'

// Pet package parsing.
export {
  DEFAULT_FRAME_MS,
  IMAGE_EXTS,
  ROW_FRAME_COUNTS,
  ROW_NAMES,
  assessPackageDir,
  parsePetJson,
  stripBom,
} from './pet-format.js'
export type {
  AssessPackageResult,
  ParsePetJsonResult,
  ParsedPet,
  PetAnimationState,
} from './pet-format.js'

// Per-session state machine.
export {
  REPLY_BUBBLE_MS,
  createPetProtocolStateMachine,
  createPetStateMachine,
} from './state-machine.js'
export type {
  MachineState,
  PetStateMachine,
  PetStateMachineEvent,
  PetStateMachineOptions,
  PetStateMachineResult,
  ProtocolMachineState,
} from './state-machine.js'

// Multi-session aggregation.
export {
  buildAllActive,
  buildTray,
  entryIdOf,
  isTopLevelSession,
  mergeSession,
  pickTop,
  shouldAutoOpen,
  statusKeyFor,
} from './multi-session.js'
export type {
  BuildTrayOptions,
  HostActivity,
  LegacySessionState,
  MergeSessionOptions,
  MergedSession,
  MultiSessionState,
  SessionSummary,
} from './multi-session.js'


// Composite-key session store/tracker.
export {
  createMultiSessionTracker,
  createPetSessionManager,
  createPetSessionStore,
  PetSessionTracker,
} from './session-store.js'
export type {
  PetSessionTrackerConstructor,
  SessionStoreActivity,
  SessionStoreEvent,
  SessionStoreOptions,
} from './session-store.js'

// Animation.
export {
  FALLBACK_FRAME_MS,
  cycleNext,
  frameIndex,
  totalDuration,
} from './animation.js'
export type { AnimationDefinition, FrameResult } from './animation.js'

// Image dimensions.
export {
  imageDims,
  spriteMime,
} from './image-dims.js'
export type { ImageDimensions } from './image-dims.js'

// Small utilities.
export { bytesToBase64 } from './base64.js'
export {
  DEFAULT_REGISTRY,
  DEFAULT_TIMEOUT_MS,
  checkForUpdate,
  compareVersions,
  parseVersion,
} from './update.js'
export type {
  CheckForUpdateOptions,
  CheckForUpdateResult,
  Version,
} from './update.js'
