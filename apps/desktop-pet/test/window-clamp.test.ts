import assert from 'node:assert/strict'
import test from 'node:test'

import { clampSpriteFullyVisible, clampSpriteMinVisible, type MonitorRect, type SpriteBox } from '../src/window-clamp'

/** 单显示器 1920×1080，原点 (0,0)。 */
const MONITOR: MonitorRect = { x: 0, y: 0, width: 1920, height: 1080 }
/** 精灵 bbox：窗口左上偏移 (20,50)，尺寸 200×240（物理 px）。 */
const BOX: SpriteBox = { offsetX: 20, offsetY: 50, width: 200, height: 240 }

test('soft clamp keeps position when sprite is fully on screen', () => {
  assert.deepEqual(clampSpriteMinVisible(100, 100, BOX, [MONITOR]), { x: 100, y: 100 })
})

test('soft clamp pulls sprite back to a 32px strip at the right edge', () => {
  // bbox 左缘 = 1880+20 = 1900，仅 20px 可见
  assert.deepEqual(clampSpriteMinVisible(1880, 100, BOX, [MONITOR]), { x: 1868, y: 100 })
  // bbox 完全拖出右缘也要拉回同一条
  assert.deepEqual(clampSpriteMinVisible(2000, 100, BOX, [MONITOR]), { x: 1868, y: 100 })
})

test('soft clamp pulls sprite back to a 32px strip at the left edge (negative x)', () => {
  // bbox = (-280..-80)，完全在左缘外
  assert.deepEqual(clampSpriteMinVisible(-300, 100, BOX, [MONITOR]), { x: -188, y: 100 })
  // 左侧只剩 10px 可见：bbox=(-210..-10)
  assert.deepEqual(clampSpriteMinVisible(-230, 100, BOX, [MONITOR]), { x: -188, y: 100 })
})

test('soft clamp leaves exactly-32px visibility untouched', () => {
  // bbox 左缘 = 1868+20 = 1888，右缘外可见正好 32px
  assert.deepEqual(clampSpriteMinVisible(1868, 100, BOX, [MONITOR]), { x: 1868, y: 100 })
})

test('soft clamp pulls sprite back at the bottom edge', () => {
  // bbox 顶 = 1040+50 = 1090，底部已不可见
  assert.deepEqual(clampSpriteMinVisible(100, 1040, BOX, [MONITOR]), { x: 100, y: 998 })
})

test('soft clamp pulls sprite back at the top edge (negative y)', () => {
  // bbox = (-350..-110)，完全在顶缘外
  assert.deepEqual(clampSpriteMinVisible(100, -400, BOX, [MONITOR]), { x: 100, y: -258 })
})

test('soft clamp uses the union bounds of multiple monitors', () => {
  // 主屏 (0,0,1920,1080) + 右侧竖屏 (1920,-200,1080,1920)：
  // 并集包围盒 (0,-200)-(3000,1720)，精灵可拖进副屏区域
  const monitors: MonitorRect[] = [
    MONITOR,
    { x: 1920, y: -200, width: 1080, height: 1920 },
  ]
  // y=-100 位于副屏内（合法），x 拖出副屏右缘：bbox 左 = 3000
  assert.deepEqual(clampSpriteMinVisible(2980, -100, BOX, monitors), { x: 2948, y: -100 })
  // 主屏内正常位置不受副屏影响
  assert.deepEqual(clampSpriteMinVisible(100, 100, BOX, monitors), { x: 100, y: 100 })
})

test('soft clamp degrades to half-visibility when monitor is smaller than the strip', () => {
  // 40×30 的显示器：两侧各留 32px 共需 64px > 40 放不下 → mvX 退化为并集半边长
  // floor(40/2)=20，mvY 退化为 floor(30/2)=15
  const tiny: MonitorRect = { x: 0, y: 0, width: 40, height: 30 }
  assert.deepEqual(clampSpriteMinVisible(10, 0, BOX, [tiny]), { x: 0, y: -35 })
})

test('soft clamp is a no-op without monitors', () => {
  assert.deepEqual(clampSpriteMinVisible(-5000, -5000, BOX, []), { x: -5000, y: -5000 })
})

test('hard clamp keeps position when sprite is fully on screen', () => {
  assert.deepEqual(clampSpriteFullyVisible(100, 100, BOX, [MONITOR]), { x: 100, y: 100 })
})

test('hard clamp aligns sprite to the right edge when it overflows', () => {
  // bbox = (1820..2020)，右缘超出 100px → 整体拉回对齐右缘
  assert.deepEqual(clampSpriteFullyVisible(1800, 100, BOX, [MONITOR]), { x: 1700, y: 100 })
})

test('hard clamp aligns sprite to the bottom edge when it overflows', () => {
  // bbox = (950..1190)，底缘超出 110px → 拉回对齐底缘
  assert.deepEqual(clampSpriteFullyVisible(100, 900, BOX, [MONITOR]), { x: 100, y: 790 })
})

test('hard clamp aligns sprite to the top-left for negative positions', () => {
  // bbox 左 = -280、顶 = -350 → 拉回 bbox 左顶对齐 (0,0)
  assert.deepEqual(clampSpriteFullyVisible(-300, -400, BOX, [MONITOR]), { x: -20, y: -50 })
})

test('hard clamp targets the monitor containing the restore coordinates', () => {
  // 主屏 (0,0,1920,1080) + 右侧竖屏 (1920,0,1080,1920)
  const monitors: MonitorRect[] = [
    MONITOR,
    { x: 1920, y: 0, width: 1080, height: 1920 },
  ]
  // 坐标在副屏内：越界也只钳到副屏，不拉回主屏
  // bbox = (2920..3120)，右缘超出副屏 120px → 对齐副屏右缘
  assert.deepEqual(clampSpriteFullyVisible(2900, 300, BOX, monitors), { x: 2780, y: 300 })
  // 副屏内的合法位置不动
  assert.deepEqual(clampSpriteFullyVisible(2200, 300, BOX, monitors), { x: 2200, y: 300 })
})

test('hard clamp falls back to the primary monitor when coordinates hit no monitor', () => {
  // 主屏在 (0,0)，副屏向左延伸 (-1920..0)：坐标 (-2000,-2000) 两屏都不命中
  // → 钳到 monitors[0]（主显示器），而不是几何上更近的副屏
  const monitors: MonitorRect[] = [
    MONITOR,
    { x: -1920, y: 0, width: 1920, height: 1080 },
  ]
  assert.deepEqual(clampSpriteFullyVisible(-2000, -2000, BOX, monitors), { x: -20, y: -50 })
})

test('hard clamp centers the sprite when the monitor is smaller than it', () => {
  // 120×100 的显示器放不下 200×240 的精灵：bbox 居中于显示器
  const tiny: MonitorRect = { x: 0, y: 0, width: 120, height: 100 }
  assert.deepEqual(clampSpriteFullyVisible(10, 10, BOX, [tiny]), { x: -60, y: -120 })
})

test('hard clamp is a no-op without monitors', () => {
  assert.deepEqual(clampSpriteFullyVisible(-5000, -5000, BOX, []), { x: -5000, y: -5000 })
})
