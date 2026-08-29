import test from 'node:test'
import assert from 'node:assert/strict'

import { createBridge } from '../lib/index.mjs'

// Mimics cordis 的严格属性访问：未在 inject 里声明的服务式读取直接抛错。
const RESERVED_WORDS = ['prototype', 'then']

function isSpecialProperty(prop) {
  return typeof prop === 'symbol'
    || RESERVED_WORDS.includes(prop)
    || parseInt(prop).toString() === prop
    || prop.startsWith('_')
}

function makeStrictCtx({ inject = ['webServer'] } = {}) {
  const target = {
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) { return fn() },
    on() {},
    emit() {},
    get(name) {
      return inject.includes(name) ? undefined : undefined
    },
  }
  return new Proxy(target, {
    get(t, prop) {
      if (isSpecialProperty(prop)) return Reflect.get(t, prop)
      if (prop in t) return t[prop]
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

test('createBridge 不读取 ctx 上未声明的服务（cordis strict inject）', () => {
  assert.doesNotThrow(() => {
    createBridge(makeStrictCtx(), { enabled: false })
  })
})
