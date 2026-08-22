/**
 * Activity priority/selection helpers used by the desktop multi-session tray.
 */

import type { PetActivityState } from './types.js'

/** Multi-session display priority: needs input > blocked > ready > running > idle. */
export const ACTIVITY_PRIORITY: Readonly<Record<PetActivityState, number>> = Object.freeze({
  idle: 0,
  running: 1,
  ready: 2,
  blocked: 3,
  waiting: 4,
})

/** Legacy tray sort priority (lower number = more urgent), as in the original plugin. */
export const STATE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  waiting: 0,
  failed: 1,
  ready: 2,
  working: 3,
  idle: 4,
})

/** Internal tray sort priority that also understands protocol activity states. */
export const TRAY_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  waiting: 0,
  failed: 1,
  blocked: 1,
  ready: 2,
  working: 3,
  running: 3,
  idle: 4,
})

export function priorityOf(state: PetActivityState): number {
  return ACTIVITY_PRIORITY[state]
}

export function selectDisplayState(
  states: readonly PetActivityState[],
): PetActivityState {
  let selected: PetActivityState = 'idle'
  for (const state of states) {
    if ((ACTIVITY_PRIORITY[state] ?? 0) > (ACTIVITY_PRIORITY[selected] ?? 0)) {
      selected = state
    }
  }
  return selected
}

/** Map a legacy machine state to the protocol-facing activity state. */
export function toActivityState(state: string): PetActivityState {
  switch (state) {
    case 'working':
      return 'running'
    case 'failed':
      return 'blocked'
    case 'running':
    case 'blocked':
    case 'waiting':
    case 'ready':
    case 'idle':
      return state
    default:
      return 'idle'
  }
}
