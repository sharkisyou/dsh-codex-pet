/**
 * Pet state machine: DSH signal event stream -> pet state and bubble text.
 *
 * Pure logic, no side effects. Each session should have its own state machine
 * instance, keyed by `(agent, sessionId)`.
 */

export const REPLY_BUBBLE_MS = 5000

export type MachineState = 'idle' | 'working' | 'waiting' | 'failed'
export type ProtocolMachineState = 'idle' | 'running' | 'waiting' | 'blocked'

export interface PetStateMachineEvent {
  kind?: string
  type?: string
  ts: number
  status?: string
  name?: string
  isQuestion?: boolean
}

export interface PetStateMachineResult {
  state: MachineState | ProtocolMachineState
  bubbleKey: string
  bubbleParams: Record<string, unknown> | null
}

export interface PetStateMachineOptions {
  /**
   * Use the wire-protocol activity vocabulary (`running`/`blocked`) instead of
   * the legacy plugin vocabulary (`working`/`failed`).
   */
  stateStyle?: 'legacy' | 'protocol'
  /** Optional identity metadata for debugging/inspection. */
  agent?: string
  sessionId?: string
  /** Optional pre-composed composite key. */
  key?: string
}

export interface PetStateMachine {
  readonly agent?: string
  readonly sessionId?: string
  apply(event: PetStateMachineEvent): PetStateMachineResult
}

export function createPetStateMachine(options: PetStateMachineOptions = {}): PetStateMachine {
  const protocol = options.stateStyle === 'protocol' ||
    (options.stateStyle === undefined && (options.agent !== undefined || options.sessionId !== undefined || options.key !== undefined))
  let agentRunning = false
  let tool: { name: string; isQuestion: boolean } | null = null
  let approvals = 0
  let subagents = 0
  let failedAt: number | null = null
  let idleSince: number | null = null

  function workingState(): MachineState | ProtocolMachineState {
    return protocol ? 'running' : 'working'
  }

  function failedState(): MachineState | ProtocolMachineState {
    return protocol ? 'blocked' : 'failed'
  }

  function compute(ts: number): PetStateMachineResult {
    if (failedAt !== null) {
      return { state: failedState(), bubbleKey: 'failed', bubbleParams: null }
    }
    if (approvals > 0) {
      return { state: 'waiting', bubbleKey: 'waitingApproval', bubbleParams: null }
    }
    if (tool !== null && tool.isQuestion) {
      return { state: 'waiting', bubbleKey: 'waitingAnswer', bubbleParams: null }
    }
    if (subagents > 0) {
      return { state: workingState(), bubbleKey: 'subagentWorking', bubbleParams: null }
    }
    if (agentRunning || (tool !== null && !tool.isQuestion)) {
      if (tool !== null && !tool.isQuestion) {
        return { state: workingState(), bubbleKey: 'executingTool', bubbleParams: { name: tool.name } }
      }
      return { state: workingState(), bubbleKey: 'thinking', bubbleParams: null }
    }
    if (idleSince !== null && ts - idleSince < REPLY_BUBBLE_MS) {
      return { state: 'idle', bubbleKey: 'awaitingReply', bubbleParams: null }
    }
    return { state: 'idle', bubbleKey: 'idle', bubbleParams: null }
  }

  function enterIdle(ts: number): void {
    if (idleSince === null) idleSince = ts
  }

  function apply(event: PetStateMachineEvent): PetStateMachineResult {
    const ts = event.ts
    let kind = event.kind ?? event.type ?? ''

    // Accept wire-protocol event type names directly.
    switch (kind) {
      case 'session/status':
        kind = 'agent-status'
        break
      case 'session/error':
        kind = 'error'
        break
      case 'tool/start':
        kind = 'tool-start'
        break
      case 'tool/end':
        kind = 'tool-end'
        break
      case 'approval/start':
        kind = 'approval-start'
        break
      case 'approval/end':
        kind = 'approval-end'
        break
      case 'question/start':
        kind = 'tool-start'
        if (!event.isQuestion) {
          // The wire event is independent of tool naming.
          event = { ...event, isQuestion: true }
        }
        break
      case 'question/end':
        kind = 'tool-end'
        break
      case 'subagent/start':
        kind = 'subagent-start'
        break
      case 'subagent/end':
        kind = 'subagent-end'
        break
      default:
        break
    }

    if (kind === 'tick') {
      return compute(ts)
    }

    // Any real activity clears the failed state.
    if (failedAt !== null && kind !== 'error') failedAt = null

    switch (kind) {
      case 'agent-status':
        if (event.status === 'running') {
          agentRunning = true
        } else {
          agentRunning = false
          idleSince = ts
        }
        break
      case 'tool-start':
        tool = { name: event.name ?? '', isQuestion: event.isQuestion === true }
        break
      case 'tool-end':
        tool = null
        break
      case 'approval-start':
        approvals++
        break
      case 'approval-end':
        if (approvals > 0) approvals--
        break
      case 'error':
        failedAt = ts
        break
      case 'subagent-start':
        subagents++
        break
      case 'subagent-end':
        if (subagents > 0) subagents--
        break
      default:
        break
    }

    if (failedAt === null && !agentRunning && tool === null && approvals === 0 && subagents === 0) {
      enterIdle(ts)
    }
    return compute(ts)
  }

  return {
    agent: options.agent,
    sessionId: options.sessionId,
    apply,
  }
}

/** Convenience alias for callers that want the protocol-facing vocabulary. */
export function createPetProtocolStateMachine(
  options: Omit<PetStateMachineOptions, 'stateStyle'> = {},
): PetStateMachine {
  return createPetStateMachine({ ...options, stateStyle: 'protocol' })
}
