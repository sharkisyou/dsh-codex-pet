/**
 * A/B 两项的服务端回归：
 *
 * A. 本地宠物卡片缩略图——`pet/thumb` 必须回小图（96×104 webp，~9KB），
 *    而不是让卡片去拉整张精灵（解码后 ~11MB/张）。
 * B. `state-sync` 源头去重——内容没变的通知不再广播（实测最忙一分钟 511 次/窗口）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import { CELL_H, CELL_W, createPetLibrary } from '../src/pet-library'
import { createPetServer } from '../src/server'
import { createSettingsStore } from '../src/settings-store'
import { createAppController } from '../src/controller'
import { createUiGateway } from '../src/ui-gateway'
import type { WsLike } from '../src/server'

class FakeSocket implements WsLike {
  listeners = new Map<string, Array<(...args: any[]) => void>>()
  sent: unknown[] = []

  on(event: string, listener: (...args: any[]) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(_code?: number, _reason?: string): void {
    this.emit('close')
  }
}

/** 真实可解码的图集（sharp 能读的 PNG，而不是只带 IHDR 的假头）。 */
async function realSprite(width = CELL_W * 8, height = CELL_H): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 40, g: 90, b: 160, alpha: 1 } } })
    .png()
    .toBuffer()
}

async function makeHarness(): Promise<{
  root: string
  controller: ReturnType<typeof createAppController>
  gateway: ReturnType<typeof createUiGateway>
  socket: FakeSocket
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-pet-thumb-'))
  const petDir = join(root, 'pets', 'alpha')
  await mkdir(petDir, { recursive: true })
  await writeFile(join(petDir, 'pet.json'), JSON.stringify({
    id: 'alpha',
    displayName: 'Pet alpha',
    description: 'desc',
    spritesheetPath: 'spritesheet.png',
    spriteVersionNumber: 1,
  }))
  await writeFile(join(petDir, 'spritesheet.png'), await realSprite())

  const library = createPetLibrary({ root: join(root, 'pets') })
  const server = createPetServer({ logger: { info() {} } })
  const store = createSettingsStore({ dataDir: join(root, 'data') })
  const controller = createAppController({ server, library, store })
  const gateway = createUiGateway({ controller })
  const socket = new FakeSocket()
  gateway.handleConnection(socket)

  return {
    root,
    controller,
    gateway,
    socket,
    cleanup: async () => {
      gateway.stop()
      controller.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

test('pet/thumb 回的是小图而不是整张精灵', async () => {
  const h = await makeHarness()
  try {
    h.socket.emit('message', JSON.stringify({ kind: 'pet/thumb', id: 'alpha' }))
    await wait()

    const thumb = h.socket.sent.find((m: any) => m.kind === 'pet-thumb') as any
    assert.ok(thumb, '应回 pet-thumb')
    assert.equal(thumb.id, 'alpha')
    assert.match(String(thumb.dataUrl), /^data:image\/webp;base64,/)
    // 整张 1536×208 图集的 data URL 是百 KB 级；缩略图必须远小于它。
    assert.ok(String(thumb.dataUrl).length < 20_000, `缩略图应是小图，实际 ${String(thumb.dataUrl).length} 字节`)
  } finally {
    await h.cleanup()
  }
})

test('pet/thumb 命中缓存：同一只宠物两次请求返回同一张图', async () => {
  const h = await makeHarness()
  try {
    const first = await h.controller.petThumbnail('alpha')
    const second = await h.controller.petThumbnail('alpha')
    assert.ok(first !== null && first === second)
  } finally {
    await h.cleanup()
  }
})

test('pet/thumb 对不存在的宠物返回 null（前端保留占位样式）', async () => {
  const h = await makeHarness()
  try {
    assert.equal(await h.controller.petThumbnail('nope'), null)
  } finally {
    await h.cleanup()
  }
})

test('state-sync：内容没变就不重复广播，内容变了才再发', async () => {
  const h = await makeHarness()
  try {
    const count = () => h.socket.sent.filter((m: any) => m.kind === 'state-sync').length

    h.controller.notify()
    await wait()
    assert.equal(count(), 1, '第一次通知应广播')

    // 连续两次内容完全相同的通知（DSH 活跃时的常态）不应该再发。
    h.controller.notify()
    h.controller.notify()
    await wait()
    assert.equal(count(), 1, '内容没变时不应重复广播')

    // 状态真的变了（设置里 zoom 改动）→ 必须照发，不能把变化吞掉。
    await h.controller.updateSettings({ zoom: 1.5 })
    await wait()
    assert.equal(count(), 2, '内容变化后应再广播一次')
  } finally {
    await h.cleanup()
  }
})
