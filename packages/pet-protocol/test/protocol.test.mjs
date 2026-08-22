import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  DEFAULT_PORT,
  DEFAULT_WS_URL,
  PROTOCOL_PATH,
  createSessionKey,
  isPetEventEnvelope,
} from '../dist/index.js'

test('protocol constants expose the versioned ws path', () => {
  assert.equal(PROTOCOL_PATH, '/v1')
  assert.equal(DEFAULT_WS_URL, `ws://127.0.0.1:${DEFAULT_PORT}${PROTOCOL_PATH}`)
})

test('session keys are composite agent:sessionId', () => {
  assert.equal(createSessionKey('dsh', 's1'), 'dsh:s1')
  assert.equal(createSessionKey('codex', 's1'), 'codex:s1')
})

test('envelope guard accepts well-formed events and rejects malformed ones', () => {
  assert.equal(isPetEventEnvelope({ agent: 'dsh', sessionId: 's1' }), true)
  assert.equal(isPetEventEnvelope({ agent: 'dsh' }), false)
  assert.equal(isPetEventEnvelope(null), false)
})

test('schema file is present and valid JSON', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'events.schema.json'), 'utf8'))
  assert.equal(schema.title, 'Pet Wire Protocol Envelope')
  assert.deepEqual(schema.required, ['agent', 'sessionId'])
})
