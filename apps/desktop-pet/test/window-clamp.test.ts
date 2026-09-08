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

test('soft clamp allows at most half the sprite out of the right edge', () => {
  // 默认 ratio=0.5：允许出屏 200/2=100px。bbox 左缘上限 = 1920-100 = 1820 → x ≤ 1800
  assert.deepEqual(clampSpriteMinVisible(1850, 100, BOX, [MONITOR]), { x: 1800, y: 100 })
  // 完全拖出右缘也拉回同一位置
  assert.deepEqual(clampSpriteMinVisible(2000, 100, BOX, [MONITOR]), { x: 1800, y: 100 })
  // 恰好一半出屏是合法贴边状态，不钳
  assert.deepEqual(clampSpriteMinVisible(1800, 100, BOX, [MONITOR]), { x: 1800, y: 100 })
})

test('soft clamp allows at most half the sprite out of the left edge (negative x)', () => {
  // bbox 右缘下限 = 0 + 200/2 = 100 → bx ≥ -100 → x ≥ -120
  assert.deepEqual(clampSpriteMinVisible(-300, 100, BOX, [MONITOR]), { x: -120, y: 100 })
  // 左侧只剩 70px 可见（< 一半）
  assert.deepEqual(clampSpriteMinVisible(-150, 100, BOX, [MONITOR]), { x: -120, y: 100 })
  // 恰好一半可见是合法状态
  assert.deepEqual(clampSpriteMinVisible(-120, 100, BOX, [MONITOR]), { x: -120, y: 100 })
})

test('soft clamp allows at most half the sprite out of the bottom edge', () => {
  // bbox 顶缘上限 = 1080 - 240/2 = 960 → y ≤ 910
  assert.deepEqual(clampSpriteMinVisible(100, 1000, BOX, [MONITOR]), { x: 100, y: 910 })
})

test('soft clamp allows at most half the sprite out of the top edge (negative y)', () => {
  // bbox 底缘下限 = 0 + 240/2 = 120 → by ≥ -120 → y ≥ -170
  assert.deepEqual(clampSpriteMinVisible(100, -400, BOX, [MONITOR]), { x: 100, y: -170 })
})

test('soft clamp uses the union bounds of multiple monitors', () => {
  // 主屏 (0,0,1920,1080) + 右侧竖屏 (1920,-200,1080,1920)：
  // 并集包围盒 (0,-200)-(3000,1720)，精灵可拖进副屏区域
  const monitors: MonitorRect[] = [
    MONITOR,
    { x: 1920, y: -200, width: 1080, height: 1920 },
  ]
  // y=-100 位于副屏内（合法），x 拖出副屏右缘超一半：bbox 左缘上限 = 3000-100 = 2900
  assert.deepEqual(clampSpriteMinVisible(2980, -100, BOX, monitors), { x: 2880, y: -100 })
  // 主屏内正常位置不受副屏影响
  assert.deepEqual(clampSpriteMinVisible(100, 100, BOX, monitors), { x: 100, y: 100 })
})

test('soft clamp clamps as much visibility as possible when monitor is smaller than the sprite', () => {
  // 40×30 的显示器放不下一半精灵（半宽 100 > 40）：区间不冲突，钳到"尽量多可见"
  // x: bx ∈ [0-100, 40-100] = [-100,-60] → x ∈ [-120,-80]，取上限 -80
  // y: by ∈ [-120, 30-120] = [-120,-90] → y ∈ [-170,-140]，取上限 -140
  const tiny: MonitorRect = { x: 0, y: 0, width: 40, height: 30 }
  assert.deepEqual(clampSpriteMinVisible(10, 0, BOX, [tiny]), { x: -80, y: -140 })
})

test('soft clamp with ratio 1 behaves like the hard clamp on one monitor', () => {
  // ratio=1 → 不允许任何部分出屏，单屏下与硬钳制结果一致
  assert.deepEqual(clampSpriteMinVisible(1800, 100, BOX, [MONITOR], 1), { x: 1700, y: 100 })
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
