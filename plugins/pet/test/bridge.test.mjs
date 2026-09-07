import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, createBridge, BRIDGE_AGENT } from '../lib/index.mjs'

// 测试环境关闭文件日志：避免把测试噪音写进真实的 ~/.dsh/logs/pet-bridge.log
process.env.DSH_PET_LOG ||= '0'

class FakeWebSocket {
  static instances = []
  static sent = []
  static reset() {
    FakeWebSocket.instances = []
    FakeWebSocket.sent = []
  }
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    FakeWebSocket.instances.push(this)
  }
  send(text) {
    const event = JSON.parse(text)
    this.sent.push(event)
    FakeWebSocket.sent.push(event)
  }
  open() {
    if (this.readyState === 1) return
    this.readyState = 1
    this.onopen?.()
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.()
  }
  serverMessage(event) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

function createHarness(options = {}) {
  FakeWebSocket.reset()
  const handlers = new Map()
  const sessionsService = options.sessions ?? {
    list: () => [],
    get: () => undefined,
  }
  const agentsService = options.agents ?? {
    get: () => undefined,
  }
  const ctx = {
    logger: { info() {} },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(fn)
    },
    effect(fn) {
      return fn()
    },
    get(key) {
      if (key === 'sessions') return sessionsService
      if (key === 'agents') return agentsService
      if (key === 'openSession') return options.openSession
      return undefined
    },
    sessions: sessionsService,
    ...(options.openSession ? { openSession: options.openSession } : {}),
  }
  const bridge = apply(ctx, { WebSocket: FakeWebSocket, ...(options.bridgeOptions ?? {}) })
  const emit = async (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler(...args)
    }
  }
  return { ctx, bridge, handlers, emit, ws: () => FakeWebSocket.instances[0] }
}

test('bridge connects and performs a hello + snapshot handshake', () => {
  const h = createHarness()
  assert.equal(h.bridge.agent, BRIDGE_AGENT)
  const ws = h.ws()
  assert.ok(ws)
  ws.open()

  const types = FakeWebSocket.sent.map((event) => event.type)
  assert.deepEqual(types, ['hello', 'snapshot', 'session/directory', 'session/sync'])
  const hello = FakeWebSocket.sent[0]
  assert.equal(hello.type, 'hello')
  assert.equal(hello.agent, BRIDGE_AGENT)
  assert.equal(hello.protocolVersion, 1)
  assert.deepEqual(FakeWebSocket.sent[1], { type: 'snapshot', agent: BRIDGE_AGENT, sessions: [] })
})

test('DSH session activity is translated to wire protocol events', async () => {
  const h = createHarness({ sessions: { list: () => [{ id: 's1', title: 'Task One' }], get: () => undefined } })
  h.ws().open()

  await h.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  assert.deepEqual(FakeWebSocket.sent.at(-1), { type: 'session/status', agent: BRIDGE_AGENT, sessionId: 's1', status: 'running' })

  await h.emit('agent/error', { agent: { id: 's1' }, message: 'boom', code: 7 })
  assert.deepEqual(FakeWebSocket.sent.at(-1), {
    type: 'session/error', agent: BRIDGE_AGENT, sessionId: 's1', message: 'boom', code: 7,
  })

  let resolveTool
  const toolPromise = h.emit('tools/execute', { agent: { id: 's1' }, name: 'bash' }, () => new Promise((resolve) => { resolveTool = resolve }))
  assert.deepEqual(FakeWebSocket.sent.at(-1), { type: 'tool/start', agent: BRIDGE_AGENT, sessionId: 's1', name: 'bash' })
  resolveTool({ ok: true })
  await toolPromise
  assert.deepEqual(FakeWebSocket.sent.at(-1), { type: 'tool/end', agent: BRIDGE_AGENT, sessionId: 's1', name: 'bash' })
})

test('ask_user_question becomes an independent question lifecycle', async () => {
  const h = createHarness()
  h.ws().open()
  let resolveQuestion
  const questionPromise = h.emit('tools/execute', {
    agent: { id: 's1' },
    name: 'ask_user_question',
    arguments: JSON.stringify({ prompt: 'Continue?' }),
  }, () => new Promise((resolve) => { resolveQuestion = resolve }))

  assert.deepEqual(FakeWebSocket.sent.at(-1), {
    type: 'question/start', agent: BRIDGE_AGENT, sessionId: 's1', prompt: 'Continue?',
  })
  resolveQuestion('yes')
  await questionPromise
  assert.deepEqual(FakeWebSocket.sent.at(-1), {
    type: 'question/end', agent: BRIDGE_AGENT, sessionId: 's1', answer: 'yes',
  })
})

test('approval requests track concurrent counts and only end at zero', async () => {
  const h = createHarness()
  h.ws().open()

  let resolveA
  let resolveB
  const a = h.emit('approval/request', { agent: { id: 's1' } }, () => new Promise((r) => { resolveA = r }))
  const b = h.emit('approval/request', { agent: { id: 's1' } }, () => new Promise((r) => { resolveB = r }))

  assert.deepEqual(FakeWebSocket.sent.at(-1), { type: 'approval/start', agent: BRIDGE_AGENT, sessionId: 's1', count: 2 })

  resolveA('ok')
  await a
  assert.equal(FakeWebSocket.sent.at(-1).type, 'approval/start')
  assert.equal(FakeWebSocket.sent.at(-1).count, 2)

  resolveB('ok')
  await b
  const afterSecondEnd = FakeWebSocket.sent.at(-1)
  assert.equal(afterSecondEnd.type, 'approval/end')
  assert.equal(afterSecondEnd.count, 0)
})

test('subagent events are resolved to the parent session', async () => {
  const sessions = new Map([
    ['child1', { header: { parentSession: 's1' }, title: 'Child' }],
  ])
  const h = createHarness({ sessions: { list: () => [], get: (id) => sessions.get(id) } })
  h.ws().open()

  await h.emit('subagent/start', { id: 'child1', name: 'research' })
  assert.deepEqual(FakeWebSocket.sent.at(-1), {
    type: 'subagent/start', agent: BRIDGE_AGENT, sessionId: 's1', childSessionId: 'child1', name: 'research',
  })

  await h.emit('subagent/end', { id: 'child1', name: 'research' })
  assert.deepEqual(FakeWebSocket.sent.at(-1), {
    type: 'subagent/end', agent: BRIDGE_AGENT, sessionId: 's1', childSessionId: 'child1', name: 'research',
  })
})

test('handshake snapshot includes sessions known from DSH and wire events', async () => {
  const h = createHarness({ sessions: { list: () => [{ id: 's1', title: 'Hello' }, { id: 's2', title: 'World' }], get: () => undefined }, bridgeOptions: { reconnectDelay: 5 } })
  const ws = h.ws()
  ws.open()
  await h.emit('agent/status', { agent: { id: 's2' }, status: 'running' })

  // Force another handshake to read the current snapshot from the bridge.
  ws.close()
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = FakeWebSocket.instances[1]
  assert.ok(second, 'should reconnect with a new socket')
  second.open()

  const snapshot = FakeWebSocket.sent.filter((event) => event.type === 'snapshot').at(-1)
  assert.ok(snapshot)
  const ids = snapshot.sessions.map((entry) => entry.sessionId).sort()
  assert.deepEqual(ids, ['s1', 's2'])
})

test('incoming session/open is forwarded to a host opener when available', async () => {
  const opened = []
  const h = createHarness({ openSession: (sessionId, reason) => { opened.push({ sessionId, reason }) } })
  const ws = h.ws()
  ws.open()
  ws.serverMessage({ type: 'session/open', agent: BRIDGE_AGENT, sessionId: 's1', reason: 'tray' })
  assert.deepEqual(opened, [{ sessionId: 's1', reason: 'tray' }])
})

test('incoming session/open emits session/open on ctx when no host opener exists', async () => {
  const emitted = []
  const h = createHarness()
  h.ctx.emit = (name, payload) => { emitted.push({ name, payload }) }
  const ws = h.ws()
  ws.open()
  ws.serverMessage({ type: 'session/open', agent: BRIDGE_AGENT, sessionId: 's1', reason: 'tray' })
  assert.deepEqual(emitted, [{ name: 'session/open', payload: { sessionId: 's1', reason: 'tray' } }])
})

test('incoming session/open enqueues a pending open for the client poller (B2)', async () => {
  const h = createHarness()
  const ws = h.ws()
  ws.open()
  ws.serverMessage({ type: 'session/open', agent: BRIDGE_AGENT, sessionId: 's1', reason: 'tray' })

  // 即便没有宿主 opener / 没有 allowlist 转发，待办队列也会记录打开意图。
  const drained = h.bridge.drainPendingOpens()
  assert.equal(drained.length, 1)
  assert.equal(drained[0].sessionId, 's1')
  assert.equal(drained[0].reason, 'tray')
  // GET 即取即清：再次 drain 为空
  assert.deepEqual(h.bridge.drainPendingOpens(), [])
})

test('pending-open queue drops consecutive duplicates and is bounded', () => {
  const h = createHarness()
  h.bridge.openSession('s1', 'tray')
  h.bridge.openSession('s1', 'tray') // 连续同会话去重
  h.bridge.openSession('s2', 'other')
  let drained = h.bridge.drainPendingOpens()
  assert.deepEqual(drained.map((entry) => entry.sessionId), ['s1', 's2'])

  // 有界：超过上限丢弃最旧
  for (let i = 0; i < 25; i++) h.bridge.openSession(`s-${i}`, 'tray')
  drained = h.bridge.drainPendingOpens()
  assert.equal(drained.length, 20)
  assert.equal(drained[0].sessionId, 's-5')
  assert.equal(drained.at(-1).sessionId, 's-24')
})

test('session titles are read from projections.values.title (rc.1 summary shape)', () => {
  const h = createHarness({
    sessions: {
      list: () => [
        { sessionId: 's1', projections: { values: { title: { title: '交接文档标题', source: { kind: 'fallback' } } } } },
        { sessionId: 's2', projections: { values: { title: '纯字符串标题' } } },
      ],
      get: () => undefined,
    },
  })
  h.ws().open()
  const directory = h.bridge.directoryEntries()
  const byId = new Map(directory.map((entry) => [entry.sessionId, entry]))
  assert.equal(byId.get('s1').title, '交接文档标题')
  assert.equal(byId.get('s2').title, '纯字符串标题')
  // 无标题时仍回退到 sessionId
  assert.notEqual(byId.get('s1').title, 's1')
})

test('async session store (rc.1) is pulled and titles applied without wiping event state', async () => {
  const h = createHarness({
    sessions: {
      list: async () => [{ sessionId: 's1', projections: { values: { title: { title: '异步标题' } } } }],
      get: () => undefined,
    },
    bridgeOptions: { refreshMs: 1000 },
  })
  const ws = h.ws()
  ws.open()
  // 同步路径读不到 async list；等后台异步拉取把标题灌入。
  await new Promise((resolve) => setTimeout(resolve, 40))
  const directory = h.bridge.directoryEntries()
  const s1 = directory.find((entry) => entry.sessionId === 's1')
  assert.ok(s1, 'async list session should be enumerated')
  assert.equal(s1.title, '异步标题')
  h.bridge.stop()
})

test('titles are folded from session/title events in live Session log entries', () => {
  const h = createHarness({
    sessions: {
      list: () => [{
        header: { id: 's1' },
        log: [
          { type: 'user/message', seq: 1, data: {} },
          { type: 'session/title', seq: 2, data: { title: '来自日志的标题', source: { kind: 'fallback' } } },
          { type: 'user/message', seq: 3, data: {} },
          { type: 'session/title', seq: 4, data: { title: '最后标题', source: { kind: 'user' } } },
        ],
      }],
      get: () => undefined,
    },
  })
  h.ws().open()
  const directory = h.bridge.directoryEntries()
  const s1 = directory.find((entry) => entry.sessionId === 's1')
  assert.ok(s1, 'session object entry should be enumerated via header.id')
  assert.equal(s1.title, '最后标题', 'must fold the LATEST session/title event')
})

test('background agent run finishing emits session/done and snapshots as ready', async () => {
  const h = createHarness({ sessions: { list: () => [{ header: { id: 's1' }, log: [] }], get: () => undefined } })
  const ws = h.ws()
  ws.open()
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'idle' })

  const done = FakeWebSocket.sent.filter((event) => event.type === 'session/done').at(-1)
  assert.ok(done, 'running→idle in a background session must emit session/done')
  assert.equal(done.sessionId, 's1')
  assert.equal(typeof done.at, 'number')
  // Snapshot/directory carry the completed session as ready for reconnect restore.
  const snap = h.bridge.snapshotSessions().find((entry) => entry.sessionId === 's1')
  assert.equal(snap && snap.state, 'ready')
})

test('current session finishing emits session/status idle, not session/done', async () => {
  const h = createHarness()
  const ws = h.ws()
  ws.open()
  h.bridge.setCurrent('s1')
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'idle' })
  const dones = FakeWebSocket.sent.filter((event) => event.type === 'session/done')
  assert.equal(dones.length, 0, 'the session the user is viewing must not show 已完成')
})

test('agent idle without a prior running state stays a plain idle status', async () => {
  const h = createHarness()
  const ws = h.ws()
  ws.open()
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'idle' })
  const dones = FakeWebSocket.sent.filter((event) => event.type === 'session/done')
  assert.equal(dones.length, 0)
  assert.equal(FakeWebSocket.sent.filter((event) => event.type === 'session/status').at(-1).status, 'idle')
})

test('setCurrent forwards session/current and consumes an existing completion', async () => {
  const h = createHarness()
  const ws = h.ws()
  ws.open()
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'idle' })
  assert.ok(FakeWebSocket.sent.some((event) => event.type === 'session/done'))

  h.bridge.setCurrent('s1')
  assert.ok(FakeWebSocket.sent.some((event) => event.type === 'session/current' && event.sessionId === 's1'))
  const snap = h.bridge.snapshotSessions().find((entry) => entry.sessionId === 's1')
  assert.equal(snap && snap.state, undefined, 'viewing consumes the completion')
})

test('opening a done session from the tray consumes its completion memory', async () => {
  const h = createHarness()
  const ws = h.ws()
  ws.open()
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'idle' })
  assert.ok(FakeWebSocket.sent.some((event) => event.type === 'session/done'))

  ws.serverMessage({ type: 'session/open', agent: 'dsh', sessionId: 's1', reason: 'tray' })
  const snap = h.bridge.snapshotSessions().find((entry) => entry.sessionId === 's1')
  assert.equal(snap && snap.state, undefined, 'tray open consumes the completion memory')
})

test('session/open never reads un-injected ctx properties (cordis proxy safety)', async () => {
  // Simulate the cordis proxy: reading un-injected names throws. The bridge
  // must survive a session/open (and openPet) without touching ctx.openSession.
  const h = createHarness()
  const baseGet = h.ctx.get.bind(h.ctx)
  h.ctx.get = (key) => {
    if (key === 'openSession' || key === 'openPet') {
      const err = new Error(`cannot get property "${key}" without inject`)
      err.code = 'INJECT_MISSING'
      throw err
    }
    return baseGet(key)
  }
  Object.defineProperty(h.ctx, 'openSession', { get() { throw new Error('cannot get property "openSession" without inject') } })
  const ws = h.ws()
  ws.open()
  // Must not throw, and should emit session/open (falling back past the dead opener).
  ws.serverMessage({ type: 'session/open', agent: BRIDGE_AGENT, sessionId: 's1', reason: 'tray' })
  assert.ok(true, 'bridge survived session/open with proxy-throwing ctx')
  // openPet must also survive and return the manual hint.
  const result = h.bridge.openPet()
  assert.equal(result.opened, false)
  assert.equal(result.hint, '请手动启动桌宠应用')
})

test('createBridge exposes a send/stop surface and validates outgoing events', () => {
  FakeWebSocket.reset()
  const bridge = createBridge({ logger: { info() {} } }, { reconnectDelay: 5, WebSocket: FakeWebSocket })
  bridge.start()
  const ws = FakeWebSocket.instances[0]
  ws.open()
  assert.equal(bridge.send({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' }), true)
  assert.equal(FakeWebSocket.sent.at(-1).type, 'session/status')
  assert.equal(bridge.send({ type: 'not-real', agent: 'dsh', sessionId: 's1' }), false)
  bridge.stop()
})

test('session/sync reflects removed sessions when the live DSH list changes', async () => {
  const live = [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }]
  const h = createHarness({
    sessions: { list: () => live.slice(), get: () => undefined },
    bridgeOptions: { reconnectDelay: 5 },
  })
  h.ws().open()
  await h.emit('agent/status', { agent: { id: 's1' }, status: 'running' })

  live.length = 0
  live.push({ id: 's1', title: 'One' })
  await h.emit('session/disposed', { id: 's2' })

  const sync = FakeWebSocket.sent.filter((event) => event.type === 'session/sync').at(-1)
  assert.deepEqual(sync.sessionIds, ['s1'])
})
