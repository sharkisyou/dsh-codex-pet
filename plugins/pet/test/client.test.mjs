import test from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 浏览器客户端（lib/client.js）是一个 `window.__ModuleLoader__.load(...)`
// 脚本，不是普通 ESM/CJS 模块。这里用 vm 模拟 ModuleLoader 加载它，并验证：
// - inject 声明包含 remote + sessions（session/open 导航所需）
// - 注册 ctx.remote.$on('session/open')，收到后调用 sessions.open(sessionId)
// - 非法 payload 被忽略
// - B2 常驻轮询 /pet/bridge/pending-open，取回的打开意图触发 sessions.open
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../lib/client.js'), 'utf8')

function loadClientModule(fetchImpl) {
  let exportsValue = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          const React = { createElement: (...args) => ({ kind: 'element', args }) }
          exportsValue = factory((spec) => {
            if (spec === 'react') return React
            throw new Error(`unexpected require: ${spec}`)
          })
        },
      },
    },
    document: undefined,
    globalThis: null,
    console,
    fetch: fetchImpl ?? (() => { throw new Error('no fetch in test') }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  return exportsValue
}

// apply() 里每个 effect 都返回 disposer（轮询 effect 会注册 interval）；
// 测试 ctx 收集 disposer 并在结尾执行，避免 interval 泄漏导致进程不退出。
function makeApplyCtx(overrides = {}) {
  const disposers = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    get(key) {
      if (key === 'sessions') return { open: (id) => ctx.opened.push(id) }
      return undefined
    },
    slots: { inject() {} },
    remote: null,
    opened: [],
    dispose() {
      for (const disposer of disposers) disposer()
    },
    ...overrides,
  }
  return ctx
}

test('client 声明 inject 含 remote + sessions', () => {
  const mod = loadClientModule()
  assert.ok(Array.isArray(mod.inject), 'inject must be an array')
  assert.ok(mod.inject.includes('remote'), 'remote service required for session/open')
  assert.ok(mod.inject.includes('sessions'), 'sessions service required for navigation')
  assert.equal(typeof mod.apply, 'function')
})

test('client 注册 session/open 并导航到会话', () => {
  const mod = loadClientModule()
  let registered = null
  const ctx = makeApplyCtx({
    remote: { $on(name, handler) { registered = { name, handler }; return () => {} } },
  })
  mod.apply(ctx)

  assert.ok(registered, 'session/open listener must be registered')
  assert.equal(registered.name, 'session/open')

  registered.handler({ sessionId: 'session-abc', reason: 'tray' })
  assert.deepEqual(ctx.opened, ['session-abc'])

  // 兼容只有 id 的 payload
  ctx.opened.length = 0
  registered.handler({ id: 'session-legacy' })
  assert.deepEqual(ctx.opened, ['session-legacy'])

  // 非法 payload 忽略
  ctx.opened.length = 0
  registered.handler({})
  registered.handler(null)
  assert.deepEqual(ctx.opened, [])

  ctx.dispose()
})

test('client 常驻轮询 pending-open 并导航（B2 兜底通道）', async () => {
  let fetchCalls = 0
  const queue = []
  const mod = loadClientModule(async () => {
    fetchCalls++
    return { ok: true, json: async () => ({ ok: true, opens: queue.splice(0) }) }
  })
  const ctx = makeApplyCtx()
  mod.apply(ctx)

  // apply 后立即轮询一次（空队列，不导航）
  assert.ok(fetchCalls >= 1, 'poller should run immediately on apply')
  assert.deepEqual(ctx.opened, [])

  // 下一轮轮询取回一个打开意图 → 导航到该会话
  queue.push({ sessionId: 'session-xyz', reason: 'tray' })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.ok(fetchCalls >= 2, 'poller should keep polling on its interval')
  assert.deepEqual(ctx.opened, ['session-xyz'])

  // 队列已清空：后续轮询不再重复导航
  ctx.opened.length = 0
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.ok(fetchCalls >= 3, 'poller should keep polling')
  assert.deepEqual(ctx.opened, [], 'drained opens must not be re-delivered')

  ctx.dispose()
})

test('client 轮询遇到网络错误或非法载荷时不抛错', async () => {
  let mode = 'error'
  const mod = loadClientModule(async () => {
    if (mode === 'error') throw new Error('network down')
    return { ok: true, json: async () => ({ ok: true, opens: 'not-an-array' }) }
  })
  const ctx = makeApplyCtx()
  mod.apply(ctx)
  assert.deepEqual(ctx.opened, [])

  mode = 'bad'
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.deepEqual(ctx.opened, [], 'invalid payload must be ignored')
  ctx.dispose()
})

test('client 在无 remote/sessions/fetch 服务时优雅降级', () => {
  const mod = loadClientModule(undefined)
  const ctx = makeApplyCtx({ remote: null })
  ctx.get = () => undefined
  assert.doesNotThrow(() => mod.apply(ctx))
  ctx.dispose()
})

test('client 上报当前会话变化到 /pet/bridge/current（完成后查看清除）', async () => {
  const posted = []
  const mod = loadClientModule(async (url, opts) => {
    const u = String(url)
    if (u.endsWith('/pet/bridge/current')) {
      posted.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ ok: true }) }
    }
    if (u.endsWith('/pet/bridge/pending-open')) {
      return { ok: true, json: async () => ({ ok: true, opens: [] }) }
    }
    throw new Error('unexpected url ' + u)
  })
  const listeners = []
  const snap = { current: 'session-cur' }
  const sessionsSvc = {
    list: {
      getSnapshot: () => snap,
      subscribe(fn) { listeners.push(fn); return () => {} },
    },
  }
  const ctx = makeApplyCtx()
  ctx.get = (key) => { if (key === 'sessions') return sessionsSvc; return undefined }
  mod.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.ok(posted.some((p) => p.sessionId === 'session-cur'), 'initial current must be reported')

  snap.current = 'session-next'
  for (const fn of listeners) fn()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.ok(posted.some((p) => p.sessionId === 'session-next'), 'current change must be reported')
  ctx.dispose()
})
