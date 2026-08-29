import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CELL_WIDTH,
  COLUMNS,
  ROWS,
  buildFallbackStates,
  clamp,
  readNumber,
  resolveSpriteUrl,
} from '../src/widget/codex-pet-widget'

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
})

test('widget atlas constants match the Codex contract', () => {
  assert.equal(CELL_WIDTH * COLUMNS, 1536)
  assert.equal(ROWS, 9)
})

test('clamps values between bounds', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})

test('reads numbers with fallbacks', () => {
  assert.equal(readNumber('1.5', 1), 1.5)
  assert.equal(readNumber('abc', 1), 1)
  assert.equal(readNumber(null, 2), 2)
  assert.equal(readNumber(undefined, 3), 3)
})

test('resolves sprite URLs relative to the manifest', () => {
  assert.equal(
    resolveSpriteUrl('/pets/hachiroku/pet.json', 'spritesheet.webp', 'https://example.com/'),
    'https://example.com/pets/hachiroku/spritesheet.webp',
  )
  assert.equal(
    resolveSpriteUrl('https://cdn.example.com/pets/a/pet.json', 'sprite.png'),
    'https://cdn.example.com/pets/a/sprite.png',
  )
})
