/**
 * 拖动起点判定的回归测试。
 *
 * 对应 2026-09-10 用户实测："鼠标拖动宠物旁边白色区域（宠物窗的透明边距），
 * 宠物也会跟着动"。窗口 345×356，精灵只占中间 216×234（zoom 0.9 @dpr1.25 实机量测），
 * 而 `.pet-stage` 铺满整个视口——拖动若挂在 stage 上就等于"整窗都是热区"。
 *
 * 测试用假 stage + 假元素（只实现 contains）驱动**真实绑定函数**，
 * 断言"按下 → 是否起拖"，即该缺陷在宿主接线处的形态。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindPetDragStart,
  isPetSurfaceTarget,
  type PetDragStartEvent,
  type PetSurface,
} from '../src/pet-drag-surface'

/** 假 DOM 节点：判定只依赖 contains，不需要真 DOM。 */
interface FakeNode {
  id: string
}

/** 覆盖给定节点的宠物面（真实 Element.contains 会连自身与后代一起命中，这里用集合模拟）。 */
function surfaceCovering(...nodes: FakeNode[]): PetSurface {
  return { contains: (other) => nodes.includes(other as unknown as FakeNode) }
}

interface FakePressEvent {
  target?: unknown
  button?: number
  pointerId?: number
}

interface FakeStage {
  captured: number[]
  addEventListener(type: string, handler: (event: PetDragStartEvent) => void): void
  setPointerCapture(pointerId: number): void
  /** 派发一次按下（默认左键、pointerId=7）。 */
  press(event: FakePressEvent): void
}

function makeStage(): FakeStage {
  const listeners = new Map<string, (event: PetDragStartEvent) => void>()
  const captured: number[] = []
  return {
    captured,
    addEventListener(type: string, handler: (event: PetDragStartEvent) => void) {
      listeners.set(type, handler)
    },
    setPointerCapture(pointerId: number) {
      captured.push(pointerId)
    },
    press(event: FakePressEvent) {
      const handler = listeners.get('pointerdown')
      if (!handler) throw new Error('pointerdown 未绑定')
      handler({
        button: event.button ?? 0,
        pointerId: event.pointerId ?? 7,
        target: (event.target ?? null) as EventTarget | null,
        clientX: 200,
        clientY: 150,
        screenX: 1000,
        screenY: 500,
      })
    },
  }
}

interface FakeDrag {
  downs: unknown[]
  pointerDown(event: PetDragStartEvent): void
}

function makeDrag(): FakeDrag {
  const downs: unknown[] = []
  return { downs, pointerDown: (event) => downs.push(event) }
}

test('空白区（stage 自身的透明边距）按下不起拖', () => {
  const stage = makeStage()
  const drag = makeDrag()
  bindPetDragStart(stage, [surfaceCovering({ id: 'pet' })], drag)

  stage.press({ target: { id: 'stage' } })

  assert.equal(drag.downs.length, 0, '透明边距按下不应起拖——窗口看不见的区域不是拖动热区')
  assert.deepEqual(stage.captured, [], '未起拖就不该捕获指针')
})

test('宠物本体按下起拖并捕获指针', () => {
  const stage = makeStage()
  const drag = makeDrag()
  const pet = { id: 'pet' }
  bindPetDragStart(stage, [surfaceCovering(pet)], drag)

  stage.press({ target: pet })

  assert.equal(drag.downs.length, 1)
  assert.deepEqual(stage.captured, [7], '起拖后捕获指针，光标甩出宠物面仍跟手')
})

test('待机剪影按下也起拖（服务端不可达时的宠物形态）', () => {
  const stage = makeStage()
  const drag = makeDrag()
  const silhouette = { id: 'pet-standby' }
  bindPetDragStart(stage, [surfaceCovering({ id: 'pet' }), surfaceCovering(silhouette)], drag)

  stage.press({ target: silhouette })

  assert.equal(drag.downs.length, 1, '待机剪影就是当时的"宠物本体"，必须拖得动')
})

test('右键按下不起拖（右键归右键菜单）', () => {
  const stage = makeStage()
  const drag = makeDrag()
  const pet = { id: 'pet' }
  bindPetDragStart(stage, [surfaceCovering(pet)], drag)

  stage.press({ target: pet, button: 2 })

  assert.equal(drag.downs.length, 0)
  assert.deepEqual(stage.captured, [])
})

test('宠物面的后代元素命中同样算本体', () => {
  const stage = makeStage()
  const drag = makeDrag()
  const pet = { id: 'pet' }
  const badge = { id: 'pet-badge' }
  bindPetDragStart(stage, [surfaceCovering(pet, badge)], drag)

  stage.press({ target: badge })

  assert.equal(drag.downs.length, 1)
})

test('isPetSurfaceTarget：空目标/无宠物面一律判否', () => {
  const petNode = { id: 'pet' }
  const pet = petNode as unknown as EventTarget
  const other = { id: 'stage' } as unknown as EventTarget
  const surface = surfaceCovering(petNode)

  assert.equal(isPetSurfaceTarget(pet, [surface]), true)
  assert.equal(isPetSurfaceTarget(other, [surface]), false)
  assert.equal(isPetSurfaceTarget(null, [surface]), false)
  assert.equal(isPetSurfaceTarget(pet, []), false)
})
