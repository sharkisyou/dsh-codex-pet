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
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../lib/client.js'), 'utf8')

function loadClientModule() {
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
    fetch: () => { throw new Error('no fetch in test') },
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
  const opened = []
  const ctx = {
    effect(fn) { return fn() },
    get(key) {
      if (key === 'sessions') return { open: (id) => opened.push(id) }
      return undefined
    },
    slots: { inject() {} },
    remote: { $on(name, handler) { registered = { name, handler }; return () => {} } },
  }
  mod.apply(ctx)

  assert.ok(registered, 'session/open listener must be registered')
  assert.equal(registered.name, 'session/open')

  registered.handler({ sessionId: 'session-abc', reason: 'tray' })
  assert.deepEqual(opened, ['session-abc'])

  // 兼容只有 id 的 payload
  opened.length = 0
  registered.handler({ id: 'session-legacy' })
  assert.deepEqual(opened, ['session-legacy'])

  // 非法 payload 忽略
  opened.length = 0
  registered.handler({})
  registered.handler(null)
  assert.deepEqual(opened, [])
})

test('client 在无 remote/sessions 服务时优雅降级', () => {
  const mod = loadClientModule()
  const ctx = {
    effect(fn) { return fn() },
    get() { return undefined },
    slots: { inject() {} },
    remote: null,
  }
  assert.doesNotThrow(() => mod.apply(ctx))
})
