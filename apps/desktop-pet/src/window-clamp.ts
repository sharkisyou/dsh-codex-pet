/**
 * 窗口位置钳制（防宠物拖出屏幕找不回来）。
 *
 * 钳制参照物是"精灵 bbox"而非窗口矩形：宠物窗口大部分是透明边距
 * （顶部气泡区 + 底部角标区），"窗口可见"≠"宠物可见"。所有坐标均为
 * 物理像素，与 Tauri outerPosition / Monitor 一致。
 *
 * 边界源是显示器**完整边界**（含任务栏）——宠物允许坐任务栏，不用排除
 * 任务栏的工作区。多显示器时传入的 monitors[0] 视为主显示器。
 */

/** 显示器完整边界（物理 px）。 */
export interface MonitorRect {
  x: number
  y: number
  width: number
  height: number
}

/** 精灵 bbox：相对窗口左上角的物理像素偏移与尺寸。 */
export interface SpriteBox {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

/** 拖动软钳制保留的最小可见条（物理 px）。 */
export const MIN_VISIBLE_PX = 32

/**
 * 软钳制（拖动中）：精灵 bbox 在显示器并集内保持至少 minVisiblePx 的
 * 可见条——保留"贴边把宠物藏起来大半"的玩法，只防完全拖丢。
 * monitors 为空（浏览器预览 / 查询失败）时原样返回。
 */
export function clampSpriteMinVisible(
  x: number,
  y: number,
  box: SpriteBox,
  monitors: readonly MonitorRect[],
  minVisiblePx: number = MIN_VISIBLE_PX,
): { x: number; y: number } {
  if (monitors.length === 0) return { x, y }
  // 多显示器取并集包围盒：拖动跨屏时以虚拟桌面整体为界
  const left = Math.min(...monitors.map((m) => m.x))
  const top = Math.min(...monitors.map((m) => m.y))
  const right = Math.max(...monitors.map((m) => m.x + m.width))
  const bottom = Math.max(...monitors.map((m) => m.y + m.height))
  // 可见条不超过并集边长的一半（显示器比条还小时退化为对半可见）
  const mvX = Math.min(minVisiblePx, Math.floor((right - left) / 2))
  const mvY = Math.min(minVisiblePx, Math.floor((bottom - top) / 2))
  let nextX = x
  const bx = x + box.offsetX
  if (bx > right - mvX) nextX = right - mvX - box.offsetX
  else if (bx + box.width < left + mvX) nextX = left + mvX - box.offsetX - box.width
  let nextY = y
  const by = y + box.offsetY
  if (by > bottom - mvY) nextY = bottom - mvY - box.offsetY
  else if (by + box.height < top + mvY) nextY = top + mvY - box.offsetY - box.height
  return { x: Math.round(nextX), y: Math.round(nextY) }
}

/**
 * 硬钳制（启动/设置恢复）：精灵 bbox 完整拉回可视范围——治愈分辨率
 * 变更/显示器拔掉后的旧存档坐标。目标显示器 = 恢复坐标 (x,y) 所在的
 * 显示器；不在任何显示器内时钳到 monitors[0]（主显示器）。
 * monitors 为空时原样返回。
 */
export function clampSpriteFullyVisible(
  x: number,
  y: number,
  box: SpriteBox,
  monitors: readonly MonitorRect[],
): { x: number; y: number } {
  if (monitors.length === 0) return { x, y }
  const target =
    monitors.find(
      (m) =>
        x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height,
    ) ?? monitors[0]
  const bx = x + box.offsetX
  const by = y + box.offsetY
  let nextX = x
  if (box.width >= target.width) {
    // 显示器放不下精灵：bbox 居中（窗口其余部分可超出显示器）
    nextX = target.x + (target.width - box.width) / 2 - box.offsetX
  } else if (bx < target.x) nextX = x + (target.x - bx)
  else if (bx + box.width > target.x + target.width) {
    nextX = x - (bx + box.width - target.x - target.width)
  }
  let nextY = y
  if (box.height >= target.height) {
    nextY = target.y + (target.height - box.height) / 2 - box.offsetY
  } else if (by < target.y) nextY = y + (target.y - by)
  else if (by + box.height > target.y + target.height) {
    nextY = y - (by + box.height - target.y - target.height)
  }
  return { x: Math.round(nextX), y: Math.round(nextY) }
}
