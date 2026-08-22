import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STATE_PRIORITY,
  buildAllActive,
  buildTray,
  createSessionKey,
  entryIdOf,
  isTopLevelSession,
  mergeSession,
  shouldAutoOpen,
  statusKeyFor,
} from '../dist/index.js'

test('statusKeyFor and entry helpers match the original contract', () => {
  assert.deepEqual(statusKeyFor('waiting', null, null, 'approval'), { bubbleKey: 'waitingApproval', bubbleParams: null })
  assert.deepEqual(statusKeyFor('waiting', null, null, 'question'), { bubbleKey: 'waitingAnswer', bubbleParams: null })
  assert.deepEqual(statusKeyFor('waiting', null, null, 'plan-review'), { bubbleKey: 'planReview', bubbleParams: null })
  assert.equal(isTopLevelSession({ id: 'a' }), true)
  assert.equal(isTopLevelSession({ id: 'a', parentId: 'p' }), false)
  assert.equal(entryIdOf({ sessionId: 'b' }), 'b')
})

test('legacy merge preserves original derived states', () => {
  const merged = mergeSession({
    sessionId: 's1',
    hostActivity: { state: 'working', bubbleKey: 'thinking', bubbleParams: null, lastEventAt: 10, pendingKind: null, acknowledged: false },
    summary: { pendingInteraction: 'plan-review', updatedAt: 20 },
    currentSession: 'current',
  })
  assert.equal(merged.state, 'waiting')
  assert.equal(merged.pendingKind, 'plan-review')
  assert.equal(merged.bubbleKey, 'planReview')
  assert.equal(merged.lastEventAt, 20)
  assert.equal(merged.active, true)
})

test('composite keys keep the same session id from different agents separate', () => {
  const items = buildTray({
    sessions: [
      { agent: 'dsh', id: 's1', displayTitle: 'DSH', running: true, updatedAt: 10 },
      { agent: 'codex', id: 's1', displayTitle: 'Codex', running: true, updatedAt: 20 },
    ],
    activities: [],
    currentSession: { agent: 'dsh', sessionId: 's1' },
  })
  assert.deepEqual(items.map((x) => x.key), ['codex:s1', 'dsh:s1'])
  assert.deepEqual(items.map((x) => x.agent), ['codex', 'dsh'])
  assert.equal(items.find((x) => x.key === 'dsh:s1').current, true)
  assert.equal(items.find((x) => x.key === 'codex:s1').current, false)
  assert.equal(createSessionKey('dsh', 's1'), 'dsh:s1')
})

test('tray and all-active filtering semantics remain correct', () => {
  const sessions = [
    { id: 's1', displayTitle: '当前错误', updatedAt: 1 },
    { id: 's2', displayTitle: '其他错误', updatedAt: 2 },
  ]
  const activities = [
    { sessionId: 's1', state: 'failed', bubbleKey: 'failed', bubbleParams: null, lastEventAt: 1, pendingKind: null, acknowledged: true },
    { sessionId: 's2', state: 'failed', bubbleKey: 'failed', bubbleParams: null, lastEventAt: 2, pendingKind: null, acknowledged: true },
  ]
  assert.deepEqual(buildTray({ sessions, activities, currentSession: 's1' }).map((x) => x.sessionId), ['s1'])
  assert.deepEqual(buildAllActive({ sessions, activities }).map((x) => x.sessionId), ['s2', 's1'])
})

test('shouldAutoOpen and STATE_PRIORITY are exported', () => {
  assert.equal(STATE_PRIORITY.waiting, 0)
  assert.equal(shouldAutoOpen([{ sessionId: 's2' }], 's1'), true)
  assert.equal(shouldAutoOpen([{ sessionId: 's1' }], 's1'), false)
})
