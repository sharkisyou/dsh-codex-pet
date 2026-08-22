import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACTIVITY_PRIORITY,
  priorityOf,
  selectDisplayState,
} from '../dist/index.js'

test('activity priority follows multi-session display rules', () => {
  assert.equal(priorityOf('waiting'), 4)
  assert.equal(priorityOf('blocked'), 3)
  assert.equal(priorityOf('ready'), 2)
  assert.equal(priorityOf('running'), 1)
  assert.equal(priorityOf('idle'), 0)
})

test('selectDisplayState picks the highest-priority active state', () => {
  assert.equal(selectDisplayState(['running', 'blocked', 'waiting']), 'waiting')
  assert.equal(selectDisplayState(['running', 'ready']), 'ready')
  assert.equal(selectDisplayState([]), 'idle')
  assert.equal(selectDisplayState(['idle', 'running']), 'running')
})

test('priority map is frozen and stable', () => {
  assert.equal(Object.isFrozen(ACTIVITY_PRIORITY), true)
})
