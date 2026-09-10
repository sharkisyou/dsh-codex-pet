/**
 * 拖动状态机的竞态回归测试（对应 2026-09-10 实机定位的三个问题）：
 *  - 锚点竞态：窗口位置现查 IPC 期间到达的移动被丢弃 → 单帧快甩整段失效；
 *  - 松手丢尾帧：pointerup 不补帧就清状态 → 最后一次移动的位移丢掉；
 *  - 锚点串台：迟到的异步锚点被套用到下一次按下。
 * 用假窗口位置 / 手动帧泵驱动状态机，断言"窗口最终被 setPosition 到哪里"。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createDragController, type DragControllerOptions, type WindowPosition } from '../src/drag-controller'
import type { MonitorRect, SpriteBox } from '../src/window-clamp'

/** 单显示器 1920×1200（物理 px）。 */
const MONITOR: MonitorRect = { x: 0, y: 0, width: 1920, height: 1200 }
/** 精灵 bbox：窗口内偏移 (64,68)、尺寸 216×234——实机 zoom=0.9 @dpr1.25 的量级。 */
const SPRITE_BOX: SpriteBox = { offsetX: 64, offsetY: 68, width: 216, height: 234 }
const DPR = 1.25

/** 按下点：client 200,150 / screen 1000,500（两者都是 CSS px，位移量一致）。 */
const PRESS = { clientX: 200, clientY: 150, screenX: 1000, screenY: 500 }

interface Deferred {
  resolve: (pos: WindowPosition) => void
  reject: (error: unknown) => void
}

interface Harness {
  controller: ReturnType<typeof createDragController>
  applied: WindowPosition[]
  logs: Array<{ scope: string; message: string; data?: unknown }>
  queries: Deferred[]
  setCache(pos: WindowPosition | null): void
  setMonitors(monitors: MonitorRect[]): void
  /** 跑掉排队的帧回调（= 一次 rAF）。 */
  pump(): void
  /** 让 promise then/catch 回调完成。 */
  tick(): Promise<void>
}

function makeHarness(overrides: Partial<DragControllerOptions> = {}): Harness {
  const applied: WindowPosition[] = []
  const logs: Array<{ scope: string; message: string; data?: unknown }> = []
  const queued: Array<() => void> = []
  const queries: Deferred[] = []
  let cache: WindowPosition | null = null
  let monitors: MonitorRect[] = [MONITOR]

  const controller = createDragController({
    getWindowPosition: () => cache,
    queryWindowPosition: () =>
      new Promise<WindowPosition>((resolve, reject) => {
        queries.push({ resolve, reject })
      }),
    getMonitorRects: () => monitors,
    queryMonitorRects: async () => monitors,
    measureSpriteBox: () => SPRITE_BOX,
    setWindowPosition: (x, y) => {
      applied.push({ x, y })
    },
    getDevicePixelRatio: () => DPR,
    scheduleFrame: (callback) => {
      queued.push(callback)
    },
    log: (scope, message, data) => {
      logs.push({ scope, message, data })
    },
    ...overrides,
  })

  return {
    controller,
    applied,
    logs,
    queries,
    setCache: (pos) => {
      cache = pos
    },
    setMonitors: (next) => {
      monitors = next
    },
    pump: () => {
      for (const callback of queued.splice(0, queued.length)) callback()
    },
    tick: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  }
}

function press(harness: Harness, at: { clientX: number; clientY: number; screenX: number; screenY: number } = PRESS): void {
  harness.controller.pointerDown({ button: 0, ...at })
}

function moveBy(harness: Harness, dx: number, dy = 0): void {
  harness.controller.pointerMove({
    clientX: PRESS.clientX + dx,
    clientY: PRESS.clientY + dy,
    screenX: PRESS.screenX + dx,
    screenY: PRESS.screenY + dy,
  })
}

test('单帧快甩：缓存锚点 + 松手补帧，位移不再整段丢', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 120)
  h.controller.pointerUp()

  // 120 CSS px × 1.25 = 150 物理 px；不再需要"锚点就绪之后再移动一次"
  assert.deepEqual(h.applied, [{ x: 1150, y: 500 }])
})

test('多报告轻推：最后一帧在松手时补上', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 6)
  moveBy(h, 12)
  moveBy(h, 18)
  h.controller.pointerUp()

  // 18 × 1.25 = 22.5 → 23；不补帧的话这里会少走最后一步（实机 36px 轻推固定丢 6px）
  assert.deepEqual(h.applied, [{ x: 1023, y: 500 }])
})

test('锚点未就绪（无缓存）时：阈值与最新光标先记下，锚点一到立即起拖', async () => {
  const h = makeHarness()
  h.setCache(null)
  press(h)
  moveBy(h, 120)
  assert.deepEqual(h.applied, [], '锚点未就绪不应移动')

  h.queries[0].resolve({ x: 1000, y: 500 })
  await h.tick()
  h.pump()

  assert.deepEqual(h.applied, [{ x: 1150, y: 500 }], '整段位移应被补上，而不是丢弃')
})

test('迟到的上一次锚点不得影响本次按下（串台防护）', async () => {
  const h = makeHarness()
  h.setCache(null)
  press(h)
  h.controller.pointerUp() // 第一次按下：锚点查询 #0 在途
  press(h)
  moveBy(h, 60) // 第二次按下：锚点查询 #1 在途

  h.queries[0].resolve({ x: 0, y: 0 }) // 陈旧锚点（属于上一次按下）
  await h.tick()
  h.pump()
  assert.deepEqual(h.applied, [], '陈旧锚点必须被丢弃')

  h.queries[1].resolve({ x: 1000, y: 500 })
  await h.tick()
  h.pump()
  assert.deepEqual(h.applied, [{ x: 1075, y: 500 }], '本次锚点生效')
})

test('不足 5px 阈值不触发拖动，也不写 start 日志', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 4)
  h.controller.pointerUp()
  h.pump()

  assert.deepEqual(h.applied, [])
  assert.equal(h.logs.some((entry) => entry.message === 'start'), false)
})

test('一帧内多次移动只应用最后一次（帧合并）', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 10)
  moveBy(h, 20)
  moveBy(h, 30)
  assert.deepEqual(h.applied, [], '帧回调未跑前不 setPosition')

  h.pump()
  assert.deepEqual(h.applied, [{ x: 1038, y: 500 }]) // 30 × 1.25 = 37.5 → 38
})

test('松手补帧后，残留的 rAF 不再重复应用', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 120)
  h.controller.pointerUp()
  assert.equal(h.applied.length, 1)

  h.pump()
  assert.equal(h.applied.length, 1, '残留帧回调必须空转')
})

test('缓存陈旧时用异步查询校正（首个应用帧之前）', async () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 }) // 陈旧：真实位置其实是 940
  press(h)
  h.queries[0].resolve({ x: 940, y: 500 })
  await h.tick()
  assert.ok(h.logs.some((entry) => entry.message === 'anchor-refreshed'))

  moveBy(h, 80)
  h.controller.pointerUp()
  assert.deepEqual(h.applied, [{ x: 1040, y: 500 }]) // 940 + 100
})

test('锚点异步查询失败：缓存锚点照常可用，并留下日志', async () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  h.queries[0].reject(new Error('outerPosition failed'))
  await h.tick()

  moveBy(h, 60)
  h.controller.pointerUp()
  assert.deepEqual(h.applied, [{ x: 1075, y: 500 }])
  assert.ok(h.logs.some((entry) => entry.message === 'anchor-failed'))
})

test('非左键按下不参与拖动', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  h.controller.pointerDown({ button: 2, ...PRESS })
  moveBy(h, 120)
  h.controller.pointerUp()

  assert.deepEqual(h.applied, [])
})

test('软钳制在拖动帧内生效（精灵至少一半可见）', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 2000) // 远超右缘
  h.controller.pointerUp()

  // 出屏量上限 = bbox 宽 216 / 2 = 108 → x ≤ 1920 + 108 - 216 - 64 = 1748
  assert.deepEqual(h.applied, [{ x: 1748, y: 500 }])
  assert.ok(h.logs.some((entry) => entry.message === 'drag soft-clamped'))
})

test('pointercancel 与松手同样补帧', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 120)
  h.controller.pointerCancel()

  assert.deepEqual(h.applied, [{ x: 1150, y: 500 }])
})

test('输入合并：位移只出现在松手事件里（无 pointermove）时也跟手', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  // 浏览器把整段位移并进 up：实机快甩 3 次里出现过 1 次（当时整段零位移）
  h.controller.pointerUp({
    clientX: PRESS.clientX + 120,
    clientY: PRESS.clientY,
    screenX: PRESS.screenX + 120,
    screenY: PRESS.screenY,
  })

  assert.deepEqual(h.applied, [{ x: 1150, y: 500 }])
  const start = h.logs.find((entry) => entry.message === 'start')
  assert.equal((start?.data as { trigger?: string } | undefined)?.trigger, 'release')
})

test('松手兜底不影响点击：不足阈值仍不产生拖动', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  h.controller.pointerUp({
    clientX: PRESS.clientX + 3,
    clientY: PRESS.clientY,
    screenX: PRESS.screenX + 3,
    screenY: PRESS.screenY,
  })

  assert.deepEqual(h.applied, [])
})

test('拖动结束后状态复位，下一次拖动照常', () => {
  const h = makeHarness()
  h.setCache({ x: 1000, y: 500 })
  press(h)
  moveBy(h, 40)
  h.controller.pointerUp()
  h.pump()

  press(h)
  moveBy(h, 40)
  h.controller.pointerUp()

  assert.deepEqual(h.applied, [
    { x: 1050, y: 500 },
    { x: 1050, y: 500 },
  ])
})
