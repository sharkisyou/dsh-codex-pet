import assert from 'node:assert/strict'
import test from 'node:test'

import { clampScale, wheelZoomDirection } from '../src/pet-shell'

test('clamps scale within the allowed range', () => {
  assert.equal(clampScale(1), 1)
  assert.equal(clampScale(0), 0.4)
  assert.equal(clampScale(10), 3)
  assert.equal(clampScale(0.7, 0.5, 2), 0.7)
  assert.equal(clampScale(0.2, 0.5, 2), 0.5)
})

test('derives wheel zoom direction from deltaY', () => {
  assert.equal(wheelZoomDirection(-100), 1)
  assert.equal(wheelZoomDirection(0), -1)
  assert.equal(wheelZoomDirection(100), -1)
})
