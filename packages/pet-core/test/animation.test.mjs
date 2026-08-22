import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_FRAME_MS, cycleNext, frameIndex, totalDuration } from '../dist/index.js'

test('loop and once animation frame selection', () => {
  const anim = { frameCount: 6, timingMs: new Array(6).fill(100), playback: 'loop' }
  assert.deepEqual(frameIndex(anim, 0), { frame: 0, finished: false })
  assert.deepEqual(frameIndex(anim, 550), { frame: 5, finished: false })
  assert.deepEqual(frameIndex(anim, 600), { frame: 0, finished: false })
  const once = { frameCount: 4, timingMs: new Array(4).fill(100), playback: 'once' }
  assert.deepEqual(frameIndex(once, 401), { frame: 3, finished: true })
})

test('non-uniform timing and single-frame animations', () => {
  const anim = { frameCount: 3, timingMs: [240, 180, 180], playback: 'loop' }
  assert.deepEqual(frameIndex(anim, 419), { frame: 1, finished: false })
  assert.deepEqual(frameIndex(anim, 420), { frame: 2, finished: false })
  assert.deepEqual(frameIndex({ frameCount: 1 }, 999), { frame: 0, finished: false })
  assert.equal(totalDuration([100, 100, 100], 3), 300)
})

test('cycleNext cycles click skills', () => {
  assert.equal(cycleNext('amaterasu', ['amaterasu', 'kirin']), 'kirin')
  assert.equal(cycleNext('susanoo', ['amaterasu', 'kirin']), 'amaterasu')
  assert.equal(cycleNext('x', []), null)
  assert.equal(FALLBACK_FRAME_MS, 140)
})
