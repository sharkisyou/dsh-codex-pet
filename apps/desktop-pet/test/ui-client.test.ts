/**
 * UI 客户端断线行为的回归测试（对应"设置改了却没了"这条链路）：
 *  1. 断线时 `send` 丢弃不再无声——写 `send-dropped` 日志；
 *  2. 断线期间攒下的设置补丁按 key 合并（last-write-wins），重连后**等快照到达**再补发
 *     （顺序反了会被服务端旧快照覆盖回去）；
 *  3. 补发成功即清槽，不会在后续重连里重复补发；补发时又断了则保留。
 *
 * 用假 `WebSocket` + 假 `window` 驱动（本文件独立进程运行，全局桩不影响其它测试文件）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createUiClient } from '../src/ui-client'

class FakeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeSocket[] = []

  readyState: number = FakeSocket.CONNECTING
  sent: Array<Record<string, unknown>> = []
  /** 让指定 kind 的发送抛错（模拟"连着但写失败"）。 */
  failKind: string | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>
    if (this.failKind !== null && message.kind === this.failKind) throw new Error('socket write failed')
    this.sent.push(message)
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED
  }

  /* ---- 测试驱动 ---- */
  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  drop(): void {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.()
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  kinds(): string[] {
    return this.sent.map((message) => String(message.kind))
  }
}

// 本文件专用桩：ui-client 在构造时会读 window.location.search，并用全局 WebSocket。
;(globalThis as { window?: unknown }).window = { location: { search: '' } }
;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket

function newClient(): { client: ReturnType<typeof createUiClient>; socket: FakeSocket } {
  FakeSocket.instances = []
  const client = createUiClient({ url: 'ws://test/v1/ui', reconnect: false })
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]
  assert.ok(socket, 'client should create a socket')
  return { client, socket }
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '))
  }
  return { lines, restore: () => { console.log = original } }
}

test('断线时发送被丢弃：写 send-dropped 日志且不抛错', () => {
  const capture = captureLogs()
  try {
    const { client, socket } = newClient()
    client.updateSettings({ zoom: 1.4 }) // socket 仍在 CONNECTING
    assert.deepEqual(socket.kinds(), [])
    assert.ok(
      capture.lines.some((line) => line.includes('[ui] send-dropped') && line.includes('settings/update')),
      `期望 send-dropped 日志，实际：${capture.lines.join(' | ')}`,
    )
  } finally {
    capture.restore()
  }
})

test('断线期间攒下的设置补丁：重连后先拉快照，快照到达才补发', () => {
  const capture = captureLogs()
  try {
    const { client, socket } = newClient()
    client.updateSettings({ windowX: 111, windowY: 222 }) // 丢弃 → 进槽
    socket.open()
    assert.deepEqual(socket.kinds(), ['state/get'], '快照未到前不应补发')

    socket.deliver({ kind: 'state', state: {} })
    assert.deepEqual(socket.kinds(), ['state/get', 'settings/update'])
    assert.deepEqual(socket.sent[1].patch, { windowX: 111, windowY: 222 })
    assert.ok(capture.lines.some((line) => line.includes('settings-replayed')))
  } finally {
    capture.restore()
  }
})

test('state-sync 同样算快照到达（gateway 也用它推快照）', () => {
  const { client, socket } = newClient()
  client.updateSettings({ zoom: 1.3 })
  socket.open()
  socket.deliver({ kind: 'state-sync', settings: {}, agents: [] })
  assert.deepEqual(socket.kinds(), ['state/get', 'settings/update'])
})

test('多次丢弃按 key 合并（last-write-wins），补发只发一笔', () => {
  const { client, socket } = newClient()
  client.updateSettings({ zoom: 1.4, windowX: 5 })
  client.updateSettings({ zoom: 1.6 })
  socket.open()
  socket.deliver({ kind: 'state', state: {} })

  assert.equal(socket.sent.length, 2)
  assert.deepEqual(socket.sent[1].patch, { zoom: 1.6, windowX: 5 })
})

test('已连接但快照未到时的新补丁：与槽里旧 key 合并发送，不丢旧 key', () => {
  const { client, socket } = newClient()
  client.updateSettings({ zoom: 1.4 }) // CONNECTING → 槽 = {zoom:1.4}
  socket.open() // 已连接，快照还没到 → 槽仍在
  client.updateSettings({ windowX: 7 })

  assert.deepEqual(socket.kinds(), ['state/get', 'settings/update'])
  assert.deepEqual(socket.sent[1].patch, { zoom: 1.4, windowX: 7 })
})

test('补发成功即清槽：后续重连不再重复补发', () => {
  const { client, socket } = newClient()
  client.updateSettings({ windowX: 1 })
  socket.open()
  socket.deliver({ kind: 'state', state: {} })
  assert.deepEqual(socket.kinds(), ['state/get', 'settings/update'])

  socket.drop()
  client.connect()
  const reconnected = FakeSocket.instances[FakeSocket.instances.length - 1]
  assert.notEqual(reconnected, socket)
  reconnected.open()
  reconnected.deliver({ kind: 'state', state: {} })

  assert.deepEqual(reconnected.kinds(), ['state/get'], '槽已清，不应再补发')
})

test('补发时再次断掉：槽保留，下次重连继续补', () => {
  const { client, socket } = newClient()
  client.updateSettings({ windowX: 42, windowY: 43 })

  socket.open()
  socket.failKind = 'settings/update' // 这一轮补发写失败
  socket.deliver({ kind: 'state', state: {} })
  assert.deepEqual(socket.kinds(), ['state/get'], '写失败不算送达')

  socket.failKind = null
  socket.drop()
  client.connect()
  const reconnected = FakeSocket.instances[FakeSocket.instances.length - 1]
  reconnected.open()
  reconnected.deliver({ kind: 'state', state: {} })

  assert.deepEqual(reconnected.kinds(), ['state/get', 'settings/update'])
  assert.deepEqual(reconnected.sent[1].patch, { windowX: 42, windowY: 43 })
})
