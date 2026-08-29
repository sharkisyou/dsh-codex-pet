import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { apply, createBridge } from '../lib/index.mjs'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

class FakeWebSocket {
  static instances = []
  static reset() {
    FakeWebSocket.instances = []
  }
  constructor(url) {
    this.url = url
    this.readyState = 0
    FakeWebSocket.instances.push(this)
  }
  send() {}
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
}

function makeCtx({ webServer } = {}) {
  return {
    logger: { info() {} },
    effect(fn) {
      return fn()
    },
    on() {},
    get() { return undefined },
    ...(webServer ? { webServer } : {}),
  }
}

test('disabled bridge does not connect until enabled', () => {
  FakeWebSocket.reset()
  const bridge = createBridge(makeCtx(), { enabled: false, WebSocket: FakeWebSocket })
  assert.equal(bridge.isEnabled(), false)
  assert.equal(bridge.getStatus().enabled, false)
  assert.equal(FakeWebSocket.instances.length, 0)

  bridge.setEnabled(true)
  assert.equal(bridge.isEnabled(), true)
  assert.equal(FakeWebSocket.instances.length, 1)
  bridge.stop()
})

test('setEnabled(false) stops the socket and setEnabled(true) reconnects', () => {
  FakeWebSocket.reset()
  const bridge = createBridge(makeCtx(), { enabled: true, WebSocket: FakeWebSocket })
  bridge.start()
  assert.equal(FakeWebSocket.instances.length, 1)

  const disabled = bridge.setEnabled(false)
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.connected, false)
  assert.equal(bridge.isEnabled(), false)

  bridge.setEnabled(true)
  assert.equal(bridge.isEnabled(), true)
  assert.equal(FakeWebSocket.instances.length, 2)
  bridge.stop()
})

test('apply registers /pet/bridge HTTP status and enabled routes', async () => {
  FakeWebSocket.reset()
  let registered
  const responses = []
  const res = {
    writeHead(code, headers) {
      this.code = code
      this.headers = headers
    },
    end(body) {
      responses.push(JSON.parse(body))
    },
  }
  const webServer = {
    register(route) {
      registered = route
    },
  }
  const bridge = apply(makeCtx({ webServer }), { enabled: true, WebSocket: FakeWebSocket })
  assert.ok(registered)
  assert.equal(registered.path, '/pet')
  assert.ok(registered.handler)

  // GET status
  await registered.handler({ url: '/pet/bridge/status', method: 'GET' }, res)
  assert.equal(responses.at(-1).ok, true)
  assert.equal(responses.at(-1).enabled, true)

  // POST enabled=false
  const body = JSON.stringify({ enabled: false })
  const req = {
    url: '/pet/bridge/enabled',
    method: 'POST',
    on(event, cb) {
      if (event === 'data') cb(body)
      if (event === 'end') cb()
    },
  }
  await registered.handler(req, res)
  assert.equal(responses.at(-1).ok, true)
  assert.equal(responses.at(-1).enabled, false)
  assert.equal(bridge.isEnabled(), false)

  // unknown route falls through as 404
  await registered.handler({ url: '/pet/bridge/nope', method: 'GET' }, res)
  assert.equal(responses.at(-1).ok, false)
})


test('package metadata ships the settings client and dsh.client declaration', () => {
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.ok(packageJson.files.includes('lib/client.js'))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.equal(packageJson.peerDependencies.react, '^18.2.0')
})
