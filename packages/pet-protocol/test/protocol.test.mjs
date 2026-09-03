import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  DEFAULT_PORT,
  DEFAULT_WS_URL,
  EVENT_TYPES,
  PROTOCOL_PATH,
  PROTOCOL_VERSION,
  assertPetEvent,
  createSessionKey,
  isPetEvent,
  isPetEventEnvelope,
  parsePetEvent,
  validatePetEvent,
} from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

test('protocol constants expose the versioned ws path and version', () => {
  assert.equal(PROTOCOL_PATH, '/v1')
  assert.equal(PROTOCOL_VERSION, 1)
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

test('schema file declares the full public event set', () => {
  const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'events.schema.json'), 'utf8'))
  assert.equal(schema.title, 'Pet Wire Protocol Events')
  assert.equal(schema.type, 'object')
  assert.ok(Array.isArray(schema.oneOf))

  const eventTypes = schema.oneOf
    .map((entry) => entry.$ref.split('/').pop())
    .sort()
  assert.deepEqual(
    eventTypes,
    [
      'ApprovalEndEvent',
      'ApprovalStartEvent',
      'HelloEvent',
      'QuestionEndEvent',
      'QuestionStartEvent',
      'SessionCurrentEvent',
      'SessionDirectoryEvent',
      'SessionDoneEvent',
      'SessionErrorEvent',
      'SessionOpenEvent',
      'SessionStatusEvent',
      'SessionSyncEvent',
      'SnapshotEvent',
      'SubagentEndEvent',
      'SubagentStartEvent',
      'ToolEndEvent',
      'ToolStartEvent',
    ].sort(),
  )

  // Every event variant carries the source-tool field, and every session-scoped
  // event carries the composite session key convention.
  for (const name of eventTypes) {
    const eventSchema = schema.definitions[name]
    assert.ok(eventSchema.required.includes('type'), `${name} must declare type`)
    assert.ok(eventSchema.required.includes('agent'), `${name} must declare agent`)
    if (name !== 'HelloEvent' && name !== 'SnapshotEvent' && name !== 'SessionSyncEvent' && name !== 'SessionDirectoryEvent') {
      assert.ok(eventSchema.required.includes('sessionId'), `${name} must declare sessionId`)
    }
  }
})

test('generated types and constants are present in the public dist', () => {
  const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'events.schema.json'), 'utf8'))
  const dts = readFileSync(join(here, '..', 'dist', 'index.d.ts'), 'utf8')
  assert.match(dts, /export declare const PROTOCOL_VERSION: 1/)
  assert.match(dts, /type PetEvent/) // re-exported from generated protocol module

  const generatedDts = readFileSync(join(here, '..', 'dist', 'generated', 'protocol.d.ts'), 'utf8')
  assert.match(generatedDts, /export type PetEvent = HelloEvent \| SnapshotEvent/)
  assert.match(generatedDts, /export declare const EVENT_TYPES:/)

  // Every schema definition is represented in the generated TypeScript output.
  for (const name of Object.keys(schema.definitions)) {
    assert.match(generatedDts, new RegExp(`${name} `), `generated types must include schema definition ${name}`)
  }
})

test('runtime validation accepts legal messages', () => {
  const validEvents = [
    { type: 'hello', agent: 'dsh', protocolVersion: 1 },
    { type: 'snapshot', agent: 'dsh', sessions: [] },
    { type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' },
    { type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'idle' },
    { type: 'session/error', agent: 'codex', sessionId: 's2', message: 'boom', kind: 'tool', code: 42 },
    { type: 'tool/start', agent: 'dsh', sessionId: 's1', name: 'bash' },
    { type: 'tool/end', agent: 'dsh', sessionId: 's1', name: 'bash' },
    { type: 'approval/start', agent: 'dsh', sessionId: 's1', count: 2 },
    { type: 'approval/end', agent: 'dsh', sessionId: 's1', count: 1 },
    { type: 'question/start', agent: 'dsh', sessionId: 's1', prompt: 'Continue?' },
    { type: 'question/end', agent: 'dsh', sessionId: 's1', answer: 'yes' },
    { type: 'subagent/start', agent: 'dsh', sessionId: 'parent', childSessionId: 'child' },
    { type: 'subagent/end', agent: 'dsh', sessionId: 'parent', childSessionId: 'child' },
    { type: 'session/sync', agent: 'dsh', sessionIds: ['s1', 's2'] },
    { type: 'session/directory', agent: 'dsh', sessions: [{ sessionId: 's1', title: 'Task A' }] },
    { type: 'session/open', agent: 'dsh', sessionId: 's1', reason: 'tray' },
    { type: 'session/done', agent: 'dsh', sessionId: 's1', at: 1788365546447 },
    { type: 'session/current', agent: 'dsh', sessionId: 's1' },
  ]
  for (const event of validEvents) {
    const result = validatePetEvent(event)
    assert.equal(result.ok, true, `${event.type} should be accepted: ${JSON.stringify(result)}`)
    assert.equal(isPetEvent(event), true)
    assert.equal(parsePetEvent(event), event)
    assert.doesNotThrow(() => assertPetEvent(event))
  }
})

test('runtime validation rejects malformed messages', () => {
  const invalidEvents = [
    null,
    {},
    { type: 'session/status', agent: 'dsh' },
    { type: 'session/status', sessionId: 's1', status: 'running' },
    { type: 'session/status', agent: 'dsh', sessionId: '', status: 'running' },
    { type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'paused' },
    { type: 'wat', agent: 'dsh', sessionId: 's1' },
    { type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running', extra: true },
    { type: 'snapshot', agent: 'dsh' },
    { type: 'hello', agent: 'dsh', protocolVersion: 2 },
    { type: 'session/sync', agent: 'dsh', sessionIds: ['s1', 's1'] },
  ]
  for (const event of invalidEvents) {
    const result = validatePetEvent(event)
    assert.equal(result.ok, false, `${JSON.stringify(event)} should be rejected`)
    assert.equal(isPetEvent(event), false)
    assert.throws(() => assertPetEvent(event), TypeError)
  }
})

test('EVENT_TYPES matches the schema oneOf discriminator constants', () => {
  const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'events.schema.json'), 'utf8'))
  const fromSchema = schema.oneOf
    .map((entry) => schema.definitions[entry.$ref.split('/').pop()].properties.type.const)
    .sort()
  assert.deepEqual([...EVENT_TYPES].sort(), fromSchema)
})
