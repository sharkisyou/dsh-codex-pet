import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createPetServer } from '../src/server'
import { createPetLibrary, CELL_H, CELL_W } from '../src/pet-library'
import { createSettingsStore } from '../src/settings-store'
import { createAppController, PET_MARKET_URL } from '../src/controller'
import { createUiGateway, UI_PROTOCOL_PATH } from '../src/ui-gateway'

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

function pngBytes(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33)
  buf.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  buf[12] = 73
  buf[13] = 72
  buf[14] = 68
  buf[15] = 82
  buf[16] = (width >>> 24) & 0xff
  buf[17] = (width >>> 16) & 0xff
  buf[18] = (width >>> 8) & 0xff
  buf[19] = width & 0xff
  buf[20] = (height >>> 24) & 0xff
  buf[21] = (height >>> 16) & 0xff
  buf[22] = (height >>> 8) & 0xff
  buf[23] = height & 0xff
  return buf
}

async function writePet(root: string, id: string): Promise<void> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'pet.json'), JSON.stringify({
    id,
    displayName: `Pet ${id}`,
    description: `Desc ${id}`,
    spritesheetPath: 'spritesheet.png',
    spriteVersionNumber: 1,
  }))
  await writeFile(join(dir, 'spritesheet.png'), pngBytes(CELL_W * 8, CELL_H))
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'desktop-pet-controller-'))
}

function findMessage<T = any>(socket: FakeSocket, kind: string): T | undefined {
  return socket.sent.find((m: any) => m.kind === kind) as T | undefined
}

async function createHarness() {
  const libraryRoot = await makeTempDir()
  const dataDir = await makeTempDir()
  await writePet(libraryRoot, 'panda')
  await writePet(libraryRoot, 'cat')

  const server = createPetServer({ logger: { info() {} } })
  const library = createPetLibrary({ root: libraryRoot })
  const store = createSettingsStore({ dataDir })
  const controller = createAppController({ server, library, store, version: '0.1.0' })
  const gateway = createUiGateway({ controller })
  return { server, library, store, controller, gateway, libraryRoot, dataDir }
}

test('gateway sends a full state snapshot on connect', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)
    await new Promise((r) => setTimeout(r, 30))
    const state = findMessage<any>(ui, 'state')
    assert.ok(state)
    assert.equal(state.state.settings.selectedPetId, null)
    assert.deepEqual(state.state.pets.map((p: any) => p.id), ['cat', 'panda'])
    assert.deepEqual(state.state.agents, [])
    assert.equal(state.state.marketUrl, PET_MARKET_URL)
    assert.equal(state.state.libraryRoot, h.libraryRoot)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('settings update persists and broadcasts to all UI clients', async () => {
  const h = await createHarness()
  try {
    const ui1 = new FakeSocket()
    const ui2 = new FakeSocket()
    h.gateway.handleConnection(ui1)
    h.gateway.handleConnection(ui2)

    ui1.emit('message', JSON.stringify({ kind: 'settings/update', patch: { selectedPetId: 'panda', zoom: 1.5, awake: false } }))
    await new Promise((r) => setTimeout(r, 30))

    for (const ui of [ui1, ui2]) {
      const settings = findMessage<any>(ui, 'settings')
      assert.ok(settings)
      assert.equal(settings.settings.selectedPetId, 'panda')
      assert.equal(settings.settings.zoom, 1.5)
      assert.equal(settings.settings.awake, false)
    }
    const reloaded = createSettingsStore({ dataDir: h.dataDir })
    const saved = await reloaded.load()
    assert.equal(saved.selectedPetId, 'panda')
    assert.equal(saved.zoom, 1.5)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('settings update persists pet-window position through the UI gateway', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)
    ui.emit('message', JSON.stringify({ kind: 'settings/update', patch: { windowX: 321, windowY: 654 } }))
    await new Promise((r) => setTimeout(r, 30))
    const settings = findMessage<any>(ui, 'settings')
    assert.ok(settings)
    assert.equal(settings.settings.windowX, 321)
    assert.equal(settings.settings.windowY, 654)
    const saved = await h.store.load()
    assert.equal(saved.windowX, 321)
    assert.equal(saved.windowY, 654)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('rejects selecting a pet that is not in the library', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)
    ui.emit('message', JSON.stringify({ kind: 'settings/update', patch: { selectedPetId: 'missing' } }))
    await new Promise((r) => setTimeout(r, 30))
    const error = findMessage<any>(ui, 'error')
    assert.ok(error)
    assert.match(error.message, /宠物不存在/)
    const saved = await h.store.load()
    assert.equal(saved.selectedPetId, null)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('pet/get returns a parsed sprite package; missing id returns error', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)
    ui.emit('message', JSON.stringify({ kind: 'pet/get', id: 'cat' }))
    await new Promise((r) => setTimeout(r, 30))
    const petMsg = findMessage<any>(ui, 'pet')
    assert.ok(petMsg)
    assert.equal(petMsg.id, 'cat')
    assert.equal(petMsg.pet.displayName, 'Pet cat')
    assert.ok(petMsg.spriteDataUrl.startsWith('data:image/png;base64,'))
    assert.equal(petMsg.atlasRows, 1)

    ui.emit('message', JSON.stringify({ kind: 'pet/get', id: 'nope' }))
    await new Promise((r) => setTimeout(r, 30))
    const error = findMessage<any>(ui, 'error')
    assert.ok(error)
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('bridge connections appear in the UI source tools list', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)

    const bridge = new FakeSocket()
    h.server.handleConnection(bridge)
    bridge.emit('message', JSON.stringify({ type: 'hello', agent: 'dsh', protocolVersion: 1 }))
    await new Promise((r) => setTimeout(r, 30))

    const sync = findMessage<any>(ui, 'state-sync')
    assert.ok(sync)
    assert.deepEqual(sync.agents, ['dsh'])

    bridge.emit('close')
    await new Promise((r) => setTimeout(r, 30))
    // The second state-sync should eventually reflect an empty agent list.
    const syncs = ui.sent.filter((m: any) => m.kind === 'state-sync') as Array<{ kind: string; agents?: string[] }>
    assert.ok(syncs.length >= 2)
    assert.deepEqual(syncs[syncs.length - 1].agents, [])
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('library/reload rescans and broadcasts new pets', async () => {
  const h = await createHarness()
  try {
    const ui = new FakeSocket()
    h.gateway.handleConnection(ui)

    await writePet(h.libraryRoot, 'zebra')
    ui.emit('message', JSON.stringify({ kind: 'library/reload' }))
    await new Promise((r) => setTimeout(r, 30))

    const pets = findMessage<any>(ui, 'pets')
    assert.ok(pets)
    assert.deepEqual(pets.pets.map((p: any) => p.id), ['cat', 'panda', 'zebra'])
    // A refreshed state snapshot is also sent to the requesting client.
    const states = ui.sent.filter((m: any) => m.kind === 'state') as Array<{ state: any }>
    assert.ok(states.length >= 2)
    assert.deepEqual(states[states.length - 1].state.pets.map((p: any) => p.id), ['cat', 'panda', 'zebra'])
  } finally {
    h.gateway.stop()
    await rm(h.libraryRoot, { recursive: true, force: true })
    await rm(h.dataDir, { recursive: true, force: true })
  }
})

test('exposes the internal UI path constant', () => {
  assert.equal(UI_PROTOCOL_PATH, '/v1/ui')
})
