import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REPLY_BUBBLE_MS,
  createPetProtocolStateMachine,
  createPetStateMachine,
} from '../dist/index.js'

test('legacy state machine preserves original plugin behavior', () => {
  const sm = createPetStateMachine()
  assert.deepEqual(sm.apply({ kind: 'tick', ts: 0 }), { state: 'idle', bubbleKey: 'idle', bubbleParams: null })
  assert.deepEqual(sm.apply({ kind: 'agent-status', status: 'running', ts: 100 }), { state: 'working', bubbleKey: 'thinking', bubbleParams: null })
  assert.deepEqual(sm.apply({ kind: 'tool-start', name: 'read', isQuestion: false, ts: 200 }), { state: 'working', bubbleKey: 'executingTool', bubbleParams: { name: 'read' } })
  assert.deepEqual(sm.apply({ kind: 'tool-end', ts: 300 }), { state: 'working', bubbleKey: 'thinking', bubbleParams: null })
})

test('protocol state machine uses running/blocked', () => {
  const sm = createPetProtocolStateMachine()
  assert.deepEqual(sm.apply({ kind: 'agent-status', status: 'running', ts: 1 }), { state: 'running', bubbleKey: 'thinking', bubbleParams: null })
  assert.deepEqual(sm.apply({ kind: 'error', ts: 2 }), { state: 'blocked', bubbleKey: 'failed', bubbleParams: null })
})

test('state machine handles wire event type names and priority', () => {
  const sm = createPetStateMachine({ agent: 'dsh', sessionId: 's1' })
  assert.deepEqual(sm.apply({ type: 'session/status', status: 'running', ts: 1 }), { state: 'running', bubbleKey: 'thinking', bubbleParams: null })
  assert.deepEqual(sm.apply({ type: 'approval/start', ts: 2 }), { state: 'waiting', bubbleKey: 'waitingApproval', bubbleParams: null })
  assert.deepEqual(sm.apply({ type: 'session/error', ts: 3 }), { state: 'blocked', bubbleKey: 'failed', bubbleParams: null })
  assert.deepEqual(sm.apply({ type: 'approval/end', ts: 4 }), { state: 'running', bubbleKey: 'thinking', bubbleParams: null })
})

test('subagent and awaiting reply semantics remain correct', () => {
  const sm = createPetStateMachine()
  sm.apply({ kind: 'agent-status', status: 'running', ts: 100 })
  sm.apply({ kind: 'subagent-start', ts: 200 })
  assert.deepEqual(sm.apply({ kind: 'tick', ts: 300 }), { state: 'working', bubbleKey: 'subagentWorking', bubbleParams: null })
  sm.apply({ kind: 'subagent-end', ts: 400 })
  assert.deepEqual(sm.apply({ kind: 'agent-status', status: 'idle', ts: 500 }), { state: 'idle', bubbleKey: 'awaitingReply', bubbleParams: null })
  assert.equal(REPLY_BUBBLE_MS, 5000)
})

test('session/done turns idle-after-running into ready (已完成) and resists idle echoes', () => {
  const sm = createPetProtocolStateMachine()
  assert.deepEqual(sm.apply({ kind: 'agent-status', status: 'running', ts: 1 }), { state: 'running', bubbleKey: 'thinking', bubbleParams: null })
  assert.deepEqual(sm.apply({ kind: 'done', ts: 2 }), { state: 'ready', bubbleKey: 'ready', bubbleParams: null })
  // A repeated idle report must not drop an unviewed completion.
  assert.deepEqual(sm.apply({ kind: 'agent-status', status: 'idle', ts: 3 }), { state: 'ready', bubbleKey: 'ready', bubbleParams: null })
  // New activity clears the completion.
  assert.deepEqual(sm.apply({ kind: 'agent-status', status: 'running', ts: 4 }), { state: 'running', bubbleKey: 'thinking', bubbleParams: null })
})

test('session/done wire event type name maps to ready', () => {
  const sm = createPetStateMachine({ agent: 'dsh', sessionId: 's1' })
  assert.deepEqual(sm.apply({ type: 'session/status', status: 'running', ts: 1 }), { state: 'running', bubbleKey: 'thinking', bubbleParams: null })
  assert.deepEqual(sm.apply({ type: 'session/done', ts: 2 }), { state: 'ready', bubbleKey: 'ready', bubbleParams: null })
})
