import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_FRAME_MS,
  ROW_FRAME_COUNTS,
  ROW_NAMES,
  assessPackageDir,
  parsePetJson,
  stripBom,
} from '../dist/index.js'

test('official v1 pet.json parses to the standard nine-row model', () => {
  const json = JSON.stringify({
    id: 'feibi-jiubi',
    displayName: '菲比啾比',
    description: 'desc',
    spritesheetPath: 'spritesheet.webp',
  })
  const result = parsePetJson(json, 9)
  assert.equal(result.ok, true)
  assert.equal(result.pet.id, 'feibi-jiubi')
  assert.equal(result.pet.spriteVersionNumber, 1)
  assert.equal(result.pet.kind, null)
  assert.deepEqual(Object.keys(result.pet.states).sort(), [
    'failed', 'idle', 'jumping', 'review', 'running', 'running-left',
    'running-right', 'waiting', 'waving',
  ].sort())
  assert.equal(result.pet.states.idle.frameCount, 6)
  assert.equal(result.pet.states.waving.playback, 'once')
  assert.deepEqual(result.pet.clickAnimations, [])
})

test('directory assessment requires pet.json and an image', () => {
  assert.deepEqual(assessPackageDir(['pet.json', 'spritesheet.png']), { valid: true, reason: null })
  assert.equal(assessPackageDir([]).valid, false)
  assert.equal(assessPackageDir(['pet.json', 'README.md']).valid, false)
})

test('community animations and click interactions are normalized', () => {
  const json = JSON.stringify({
    id: 'sasuke-3',
    displayName: 'Sasuke',
    description: 'desc',
    spritesheetPath: 'spritesheet.png',
    kind: 'person',
    animations: {
      idle: { sourceRow: 'idle', frameCount: 8, timingMs: [240, 180, 180, 160, 160, 180, 180, 280] },
      amaterasu: { sourceRow: 3, frameCount: 8, playback: 'once' },
    },
    interactions: {
      click: { animations: ['amaterasu', 'missing'] },
    },
  })
  const result = parsePetJson(json, 9)
  assert.equal(result.ok, true)
  assert.equal(result.pet.kind, 'person')
  assert.equal(result.pet.states.idle.frameCount, 6)
  assert.deepEqual(result.pet.clickAnimations, ['amaterasu'])
  assert.equal(result.pet.states.amaterasu.frameCount, 4)
})

test('invalid inputs return errors', () => {
  assert.equal(parsePetJson('{ not json', 9).ok, false)
  assert.equal(parsePetJson(JSON.stringify({ id: 'x', displayName: 'x' }), 9).ok, false)
  assert.equal(parsePetJson(JSON.stringify({ id: 'x', displayName: 'x', description: 'x', spritesheetPath: 'a.png', spriteVersionNumber: 3 }), 9).ok, false)
})

test('BOM is stripped and constants are exported', () => {
  const result = parsePetJson('\uFEFF' + JSON.stringify({ id: 'x', displayName: 'x', description: 'x', spritesheetPath: 'a.png' }), 9)
  assert.equal(result.ok, true)
  assert.equal(stripBom('\uFEFFabc'), 'abc')
  assert.equal(ROW_NAMES.length, 9)
  assert.equal(ROW_FRAME_COUNTS.length, 9)
  assert.equal(DEFAULT_FRAME_MS, 140)
})
