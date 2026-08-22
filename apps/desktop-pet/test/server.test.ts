import assert from 'node:assert/strict'
import test from 'node:test'

import { createPetServer } from '../src/server'

class FakeSocket {
  listeners = new Map<string, Array<(...args: any[]) => void>>()
  sent: unknown[] = []
  closed: { code?: number; reason?: string } | null = null

  on(event: string, listener: (...args: any[]) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args)
    }
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
    this.emit('close')
  }
}

function createHarness() {
  const server = createPetServer({ logger: { info() {} } })
  const socket = new FakeSocket()
  server.handleConnection(socket)
  return { server, socket }
}

function hello(socket: FakeSocket): void {
  socket.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
}

test('accepts hello handshake and echoes protocol version', () => {
  const { server, socket } = createHarness()
  hello(socket)
  assert.equal(server.isOnline(), true)
  assert.deepEqual(server.connectedAgents(), ['dsh'])
  const echoed = socket.sent.find((event: any) => event.type === 'hello')
  assert.deepEqual(echoed, { type: 'hello', agent: 'dsh', protocolVersion: 1 })
})

test('wire session events drive the shared state machine', () => {
  const { server, socket } = createHarness()
  hello(socket)
  socket.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' }))
  assert.equal(server.currentDisplayState(), 'running')
  assert.equal(server.currentActivity()?.state, 'running')
  assert.equal(server.currentActivity()?.bubbleKey, 'thinking')

  socket.emit('message', JSON.stringify({ type: 'tool/start', agent: 'dsh', sessionId: 's1', name: 'bash' }))
  assert.equal(server.currentActivity()?.bubbleKey, 'executingTool')

  socket.emit('message', JSON.stringify({ type: 'approval/start', agent: 'dsh', sessionId: 's1' }))
  assert.equal(server.currentDisplayState(), 'waiting')
  assert.equal(server.currentActivity()?.pendingKind, 'approval')
})

test('snapshot restores state after a reconnect', () => {
  const { server, socket } = createHarness()
  hello(socket)
  socket.emit('message', JSON.stringify({
    type: 'snapshot',
    agent: 'dsh',
    sessions: [
      { sessionId: 's1', state: 'blocked', title: 'Broken task', lastEventAt: 123, acknowledged: true },
    ],
  }))
  const activity = server.currentActivity()
  assert.ok(activity)
  assert.equal(activity.state, 'blocked')
  assert.equal(activity.activityState, 'blocked')
  assert.equal(activity.title, 'Broken task')
  assert.equal(activity.acknowledged, true)
})

test('disconnecting the bridge falls back to idle', () => {
  const { server, socket } = createHarness()
  hello(socket)
  socket.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' }))
  assert.equal(server.currentDisplayState(), 'running')
  socket.emit('close')
  assert.equal(server.isOnline(), false)
  assert.equal(server.currentDisplayState(), 'idle')
})

test('session/open is sent only to the matching agent', () => {
  const { server, socket } = createHarness()
  hello(socket)
  assert.equal(server.openSession('dsh', 's1', 'tray'), true)
  const opened = socket.sent.find((event: any) => event.type === 'session/open')
  assert.deepEqual(opened, { type: 'session/open', agent: 'dsh', sessionId: 's1', reason: 'tray' })
  assert.equal(server.openSession('codex', 's1'), false)
})

test('reconnect restores activity from the handshake snapshot', () => {
  const server = createPetServer({ logger: { info() {} } })
  const first = new FakeSocket()
  server.handleConnection(first)
  first.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
  first.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' }))
  assert.equal(server.currentDisplayState(), 'running')
  first.emit('close')

  const second = new FakeSocket()
  server.handleConnection(second)
  second.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
  assert.equal(server.currentDisplayState(), 'idle')
  second.emit('message', JSON.stringify({
    type: 'snapshot',
    agent: 'dsh',
    sessions: [{ sessionId: 's1', state: 'blocked', title: 'Restored' }],
  }))
  assert.equal(server.currentDisplayState(), 'blocked')
  assert.equal(server.currentActivity()?.title, 'Restored')
})
