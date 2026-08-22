import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createPetServer } from '../src/server'
import { createPetLibrary } from '../src/pet-library'
import { createSettingsStore } from '../src/settings-store'
import { createAppController } from '../src/controller'
import { createUiGateway } from '../src/ui-gateway'

class FakeSocket {
  listeners = new Map<string, Array<(...args: any[]) => void>>()
  sent: unknown[] = []

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

  close(): void {
    this.emit('close')
  }
}

function message<T = any>(socket: FakeSocket, kind: string): T | undefined {
  return socket.sent.find((m: any) => m.kind === kind) as T | undefined
}

async function createHarness() {
  const libraryRoot = await mkdtemp(join(tmpdir(), 'pet-tray-library-'))
  const dataDir = await mkdtemp(join(tmpdir(), 'pet-tray-data-'))
  const server = createPetServer({ logger: { info() {} } })
  const library = createPetLibrary({ root: libraryRoot })
  const store = createSettingsStore({ dataDir })
  const controller = createAppController({ server, library, store })
  const gateway = createUiGateway({ controller })
  return { server, controller, gateway, libraryRoot, dataDir }
}

test('state snapshots expose a global multi-source activity tray with source names', async () => {
  const h = await createHarness()
  try {
    const bridge = new FakeSocket()
    h.server.handleConnection(bridge)
    bridge.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
    bridge.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 'd1', status: 'running' }))
    bridge.emit('message', JSON.stringify({ type: 'hello', agent: 'codex', protocolVersion: 1 }))
    bridge.emit('message', JSON.stringify({ type: 'snapshot', agent: 'codex', sessions: [{ sessionId: 'c1', state: 'ready', title: 'Codex ready' }] }))

    const activities = h.controller.activityList()
    assert.equal(activities.length, 2)
    assert.deepEqual(activities.map((a) => a.agent).sort(), ['codex', 'dsh'])
    assert.equal(activities.find((a) => a.agent === 'codex')?.title, 'Codex ready')

    const state = await h.controller.stateSnapshot()
    assert.ok(Array.isArray(state.activities))
    assert.ok(Array.isArray(state.tray))
    assert.equal(state.activities.length, 2)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('activity/ack marks the session read and tray/open forwards session/open', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)
    const bridge = new FakeSocket()
    h.server.handleConnection(bridge)
    bridge.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
    bridge.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' }))
    await new Promise((r) => setTimeout(r, 20))

    ui.emit('message', JSON.stringify({ kind: 'activity/ack', agent: 'dsh', sessionId: 's1' }))
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(h.controller.server.store.get('dsh', 's1')?.acknowledged, true)

    ui.emit('message', JSON.stringify({ kind: 'tray/open', agent: 'dsh', sessionId: 's1', reason: 'tray' }))
    await new Promise((r) => setTimeout(r, 20))
    const opened = bridge.sent.find((e: any) => e.type === 'session/open')
    assert.deepEqual(opened, { type: 'session/open', agent: 'dsh', sessionId: 's1', reason: 'tray' })
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('session/sync removes vanished sessions from the tray read model', async () => {
  const h = await createHarness()
  try {
    const bridge = new FakeSocket()
    h.server.handleConnection(bridge)
    bridge.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
    bridge.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 's1', status: 'running' }))
    bridge.emit('message', JSON.stringify({ type: 'session/status', agent: 'dsh', sessionId: 's2', status: 'running' }))
    assert.equal(h.controller.activityList().length, 2)

    bridge.emit('message', JSON.stringify({ type: 'session/sync', agent: 'dsh', sessionIds: ['s1'] }))
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(h.controller.activityList().map((a) => a.sessionId), ['s1'])
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('reading a ready session stays in the tray and is marked acknowledged', async () => {
  const h = await createHarness()
  try {
    const bridge = new FakeSocket()
    h.server.handleConnection(bridge)
    bridge.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
    bridge.emit('message', JSON.stringify({ type: 'snapshot', agent: 'dsh', sessions: [{ sessionId: 'ready1', state: 'ready', title: 'Ready' }] }))

    assert.equal(h.controller.activityList().length, 1)
    h.controller.markActivityRead('dsh', 'ready1')
    const item = h.controller.activityList().find((a) => a.sessionId === 'ready1')
    assert.ok(item)
    assert.equal(item.acknowledged, true)
    assert.equal(item.reminder, false)
    assert.equal(h.controller.trayActivities().length, 0)
    assert.equal(h.controller.tray().length, 0)
    assert.equal(h.controller.allActivities().length, 1)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})
