/**
 * Shared types for the desktop pet pure core.
 *
 * The core keeps the legacy plugin vocabulary for state-machine/multi-session
 * compatibility, while also exposing protocol-facing `PetActivityState` values.
 */

/** Display/activity state used by the wire protocol and desktop tray. */
export type PetActivityState =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'ready'

/** Legacy state-machine state (kept for compatibility with the original plugin). */
export type PetMachineState =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'failed'

/** Bubble keys understood by the pet renderer. */
export type PetBubbleKey =
  | 'idle'
  | 'awaitingReply'
  | 'thinking'
  | 'executingTool'
  | 'waitingApproval'
  | 'waitingAnswer'
  | 'planReview'
  | 'subagentWorking'
  | 'failed'
  | 'ready'
  | 'review'
  | 'waitingInput'

export type PendingKind = 'approval' | 'question' | 'plan-review'

export interface BubbleState {
  state: PetMachineState | PetActivityState
  bubbleKey: PetBubbleKey
  bubbleParams: Record<string, unknown> | null
}

export type Agent = string
export type SessionId = string
export type SessionKey = string
