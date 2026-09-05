/**
 * 回归测试：市场缩略图生成失败（"缩略图生成失败: <slug>"）。
 *
 * 背景（2026-09 实测复现）：
 * - petdex sprite 单个 1.2~3.2MB，页面渲染一次性并发请求 ~27 张；
 * - 每张下载 3 次重试、单次 20s 超时，在 CDN 突发下部分下载被终止/超时；
 * - 三种缺口叠加：超时太紧、5xx/429 不重试、无并发上限；网关把失败
 *   冒泡成全局 error（"缩略图生成失败: sahil"），前端也不重试。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import sharp from 'sharp'

import { createMarket, DEFAULT_DOWNLOAD_CONCURRENCY, type Market } from '../src/market'
import { createUiGateway } from '../src/ui-gateway'
import type { WsLike } from '../src/server'

/** 生成合法精灵图 buffer（默认 192x208 首帧尺寸）。 */
async function makeSprite(width = 192, height = 208, format: 'webp' | 'png' = 'webp'): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 4, background: { r: 128, g: 64, b: 32, alpha: 1 } },
  })
  return format === 'png' ? img.png().toBuffer() : img.webp({ quality: 80 }).toBuffer()
}

function marketPet(url: string, slug = 'testpet') {
  return {
    slug,
    displayName: 'Test Pet',
    kind: 'character',
    submittedBy: null,
    spritesheetUrl: url,
    petJsonUrl: null,
    zipUrl: null,
  }
}

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

  close(code?: number, reason?: string): void {
    void code
    void reason
    this.emit('close')
  }
}

test('getThumbnail：下载遇到 503 自动重试后成功', async () => {
  const sprite = await makeSprite(192, 208)
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    if (calls <= 2) return new Response('service unavailable', { status: 503 })
    return new Response(sprite as unknown as BodyInit, {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    })
  }) as typeof fetch
  const market = createMarket({ fetchImpl })

  const dataUrl = await market.getThumbnail(marketPet('https://petdex.test/sprite.webp'))
  assert.ok(dataUrl !== null, '503 后应重试并成功，而不是返回 null')
  assert.equal(calls, 3, '应恰好尝试 3 次（2 次 503 + 1 次成功）')
})

test('getThumbnail：并发下载数不超过并发上限（默认 12）', async () => {
  const sprite = await makeSprite(192, 208)
  let inFlight = 0
  let maxInFlight = 0
  const fetchImpl = (async () => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 30))
    inFlight--
    return new Response(sprite as unknown as BodyInit, { status: 200 })
  }) as typeof fetch
  const market = createMarket({ fetchImpl })

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      market.getThumbnail(marketPet(`https://petdex.test/sprite-${i}.webp`, `pet-${i}`))),
  )
  assert.ok(results.every((dataUrl) => dataUrl !== null))
  assert.ok(maxInFlight <= DEFAULT_DOWNLOAD_CONCURRENCY, `最大并发 ${maxInFlight} 应 ≤ ${DEFAULT_DOWNLOAD_CONCURRENCY}`)
})

test('getThumbnail：精灵图小于 192x208 时兜底裁剪，不失败', async () => {
  const tiny = await makeSprite(96, 104)
  const market = createMarket({
    fetchImpl: (async () => new Response(tiny as unknown as BodyInit, { status: 200 })) as typeof fetch,
  })

  const dataUrl = await market.getThumbnail(marketPet('https://petdex.test/tiny.webp'))
  assert.ok(dataUrl !== null && dataUrl.startsWith('data:image/webp'), '小尺寸 sprite 应兜底出图')
})

test('getThumbnail：下载超时返回 null 而不抛出', async () => {
  const fetchImpl = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return new Response('x', { status: 200 })
  }) as typeof fetch
  const market = createMarket({ fetchImpl, downloadTimeoutMs: 50 })

  assert.equal(await market.getThumbnail(marketPet('https://petdex.test/slow.webp')), null)
})

test('market/thumb 失败发送结构化 thumb-error，而非全局 error 弹错', async () => {  const controller = {
    subscribe: () => () => {},
    stateSnapshot: async () => ({}),
  } as any
  const market = { getThumbnail: async () => null } as unknown as Market
  const gateway = createUiGateway({ controller, market })
  const socket = new FakeSocket()
  gateway.handleConnection(socket)

  socket.emit('message', JSON.stringify({
    kind: 'market/thumb',
    pet: marketPet('https://petdex.test/sprite.webp', 'sahil'),
  }))
  await new Promise((resolve) => setTimeout(resolve, 20))

  const errors = socket.sent.filter((m: any) => m.kind === 'error')
  assert.deepEqual(errors, [], '缩略图只是增强项，不应触发全局错误行')
  const thumbError = socket.sent.find((m: any) => m.kind === 'market/thumb-error')
  assert.ok(thumbError, '应发送 market/thumb-error')
  assert.equal((thumbError as any).slug, 'sahil')
})

test('market/list 失败发送结构化 list-error（前端须据此复位加载态）', async () => {
  const controller = {
    subscribe: () => () => {},
    stateSnapshot: async () => ({}),
  } as any
  const market = {
    listPets: async () => { throw new Error('fetch failed') },
  } as unknown as Market
  const gateway = createUiGateway({ controller, market })
  const socket = new FakeSocket()
  gateway.handleConnection(socket)

  socket.emit('message', JSON.stringify({ kind: 'market/list' }))
  await new Promise((resolve) => setTimeout(resolve, 20))

  const errors = socket.sent.filter((m: any) => m.kind === 'error')
  assert.deepEqual(errors, [], '列表失败应走结构化事件')
  const listError = socket.sent.find((m: any) => m.kind === 'market/list-error')
  assert.ok(listError, '应发送 market/list-error')
  assert.equal((listError as any).message, 'fetch failed')
})
