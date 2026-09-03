import assert from 'node:assert/strict'
import test from 'node:test'

import { createPetSessionStore, createSessionKey, PetSessionTracker } from '../dist/index.js'

test('composite session store isolates agents with the same session id', () => {
  const store = createPetSessionStore()
  store.handle({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' })
  store.handle({ type: 'session/status', agent: 'codex', sessionId: 's1', status: 'running' })
  const activities = store.activities()
  assert.equal(activities.length, 2)
  assert.deepEqual(activities.map((a) => a.key).sort(), ['codex:s1', 'dsh:s1'])
  assert.equal(activities.find((a) => a.agent === 'dsh').state, 'running')
})

test('approval and question events produce waiting states with pending kinds', () => {
  const store = createPetSessionStore()
  store.handle({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' })
  store.handle({ type: 'approval/start', agent: 'dsh', sessionId: 's1' })
  let activity = store.get('dsh', 's1')
  assert.equal(activity.state, 'waiting')
  assert.equal(activity.pendingKind, 'approval')
  store.handle({ type: 'approval/end', agent: 'dsh', sessionId: 's1' })
  store.handle({ type: 'question/start', agent: 'dsh', sessionId: 's1' })
  activity = store.get('dsh', 's1')
  assert.equal(activity.state, 'waiting')
  assert.equal(activity.pendingKind, 'question')
  assert.equal(activity.bubbleKey, 'waitingAnswer')
})

test('sync and acknowledgement helpers work', () => {
  const store = new PetSessionTracker()
  store.handle({ type: 'session/error', agent: 'dsh', sessionId: 's1' })
  store.handle({ type: 'session/error', agent: 'dsh', sessionId: 's2' })
  assert.equal(store.activities().length, 2)
  store.sync('dsh', ['s1'])
  assert.deepEqual(store.activities().map((a) => a.key), [createSessionKey('dsh', 's1')])
  store.markAcknowledged('dsh', 's1')
  assert.equal(store.get('dsh', 's1').reminder, false)
})

test('session/done keeps the session active as ready until acknowledged (viewed)', () => {
  const store = createPetSessionStore()
  store.handle({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' })
  store.handle({ type: 'session/done', agent: 'dsh', sessionId: 's1' })
  const activity = store.get('dsh', 's1')
  assert.equal(activity.state, 'ready')
  assert.equal(activity.active, true)
  assert.equal(activity.reminder, true)
  assert.deepEqual(store.activities().map((a) => a.key), ['dsh:s1'])
  // 查看（ack）→ 不再提醒（从托盘消失），机器仍保持 ready
  store.markAcknowledged('dsh', 's1')
  assert.equal(store.get('dsh', 's1').reminder, false)
  assert.equal(store.get('dsh', 's1').state, 'ready')
})

test('session/current acknowledges the viewed session (viewing clears the reminder)', () => {
  const store = createPetSessionStore()
  store.handle({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' })
  store.handle({ type: 'session/done', agent: 'dsh', sessionId: 's1' })
  assert.equal(store.get('dsh', 's1').reminder, true)
  store.handle({ type: 'session/current', agent: 'dsh', sessionId: 's1' })
  assert.equal(store.get('dsh', 's1').reminder, false, 'viewing clears the completion reminder')
})

test('new activity after done returns the session to running', () => {
  const store = createPetSessionStore()
  store.handle({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' })
  store.handle({ type: 'session/done', agent: 'dsh', sessionId: 's1' })
  assert.equal(store.get('dsh', 's1').state, 'ready')
  store.handle({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' })
  assert.equal(store.get('dsh', 's1').state, 'running')
})
