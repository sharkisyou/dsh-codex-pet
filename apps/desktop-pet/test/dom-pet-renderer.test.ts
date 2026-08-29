import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ROWS,
  buildFallbackStates,
  resolveAnimation,
} from '../src/dom-pet-renderer'

test('builds the standard 9-row fallback atlas', () => {
  const states = buildFallbackStates()
  assert.equal(states.idle.row, 0)
  assert.equal(states['running-right'].row, 1)
  assert.equal(states['running-left'].row, 2)
  assert.equal(states.waving.row, 3)
  assert.equal(states.jumping.row, 4)
  assert.equal(states.failed.row, 5)
  assert.equal(states.waiting.row, 6)
  assert.equal(states.running.row, 7)
  assert.equal(states.review.row, 8)
  assert.equal(states.waving.playback, 'once')
  assert.equal(states.idle.playback, 'loop')
  assert.equal(ROWS, 9)
})

test('resolves display states to atlas animations', () => {
  const states = buildFallbackStates()
  assert.equal(resolveAnimation('idle', states)?.row, 0)
  assert.equal(resolveAnimation('running', states)?.row, 7)
  assert.equal(resolveAnimation('waiting', states)?.row, 6)
  assert.equal(resolveAnimation('blocked', states)?.row, 5) // → failed
  assert.equal(resolveAnimation('failed', states)?.row, 5)
  assert.equal(resolveAnimation('ready', states)?.row, 8) // → review
})

test('resolves interaction states and falls back to idle', () => {
  const states = buildFallbackStates()
  assert.equal(resolveAnimation('jumping', states)?.row, 4)
  assert.equal(resolveAnimation('waving', states)?.row, 3)
  assert.equal(resolveAnimation('running-left', states)?.row, 2)
  assert.equal(resolveAnimation('running-right', states)?.row, 1)
  // 未知状态回落 idle。
  assert.equal(resolveAnimation('unknown', states)?.row, 0)
  // atlas 里没有对应行时也回落 idle。
  const partial = { idle: states.idle }
  assert.equal(resolveAnimation('running', partial)?.row, 0)
})
