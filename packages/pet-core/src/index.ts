/**
 * Desktop Pet pure core — scaffold.
 *
 * The full implementation will port the state-machine / pet-format /
 * multi-session / animation / image-dims logic from plugins/pet to TS.
 * This scaffold only provides the shared activity vocabulary and the
 * display-priority helper used by later tickets.
 */

export type PetActivityState =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'ready'

export type PetBubbleKey =
  | 'idle'
  | 'awaitingReply'
  | 'thinking'
  | 'executingTool'
  | 'waitingApproval'
  | 'waitingAnswer'
  | 'subagentWorking'
  | 'failed'
  | 'review'

/** Multi-session display priority: needs input > blocked > ready > running > idle. */
export const ACTIVITY_PRIORITY: Readonly<Record<PetActivityState, number>> = Object.freeze({
  idle: 0,
  running: 1,
  ready: 2,
  blocked: 3,
  waiting: 4,
})

export function priorityOf(state: PetActivityState): number {
  return ACTIVITY_PRIORITY[state]
}

export function selectDisplayState(
  states: readonly PetActivityState[],
): PetActivityState {
  let selected: PetActivityState = 'idle'
  for (const state of states) {
    if (priorityOf(state) > priorityOf(selected)) selected = state
  }
  return selected
}
