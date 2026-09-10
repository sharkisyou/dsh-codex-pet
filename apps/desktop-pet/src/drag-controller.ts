/**
 * 桌宠窗口拖动状态机（手动 setPosition 管线）。
 *
 * 拖动不用 Tauri 的 `startDragging()`：原生标题栏拖动循环会触发 Aero Shake
 * 与边缘贴靠（2026-09-07 实测），所以窗口位置由**前端按帧 setPosition** 驱动。
 * 本模块只负责"手势状态机 + 锚点 + 帧调度"，DOM 事件与 Tauri 调用全部由宿主
 * 注入，因此可以在 node:test 里用假窗口 / 手动帧泵直接验证竞态
 * （见 `test/drag-controller.test.ts`）。
 *
 * 三个已实机定位的时间竞态（2026-09-10，Windows 桌宠 + 脚本化鼠标实测）：
 *
 * 1. **锚点竞态**（快甩整段失效的主因）。窗口位置若在 pointerdown 现查
 *    （Tauri IPC 往返：保温态中位 28ms、常态 20–40ms、冷调用长尾 119ms），
 *    该窗口内到达的 pointermove 会被丢弃；而"开始拖动"只能由锚点就绪**之后**
 *    到达的 pointermove 置位——手势若整段落在窗口内（快甩常被合并成一次
 *    pointermove），这次按下就是完全空操作。实测：锚点 +20ms、位移 +15ms 的
 *    单帧快甩 4/4 次零位移。
 *    修法：窗口位置与显示器由宿主**缓存**（onMoved 事件维护），pointerdown
 *    同步取锚点；缓存缺失时才回退异步查询，且该期间照常判定阈值并记录最新
 *    光标，锚点一到立即起拖补帧。
 * 2. **松手丢尾帧**。pointermove 只排一个 rAF，pointerup 若不补帧就清状态，
 *    最后一次移动的位移会被整段丢掉（单报告手势 = 全丢；多报告手势 = 少走
 *    最后一帧，实测 160px 甩动固定丢 40px、36px 轻推固定丢 6px）。
 *    修法：松手/取消时**先同步补最后一帧再清状态**。
 * 3. **锚点串台**。迟到的异步锚点若不校验"按下序号"，会被套用到下一次按下
 *    （winX/screenX 与本次按下不匹配 → 位移跳变）。
 *    修法：每次 pointerdown 递增序号，锚点落地时校验；松手时再递增让在途查询失效。
 */

import { clampSpriteMinVisible, type MonitorRect, type SpriteBox } from './window-clamp.js'

/** 指针事件里本模块用到的字段（PointerEvent / MouseEvent 均满足）。 */
export interface DragPointerPoint {
  clientX: number
  clientY: number
  screenX: number
  screenY: number
}

/** 判定"开始拖动"的位移阈值（CSS px，自按下点起算）。 */
export const DRAG_THRESHOLD_PX = 5

/** 窗口外框物理坐标。 */
export interface WindowPosition {
  x: number
  y: number
}

/** 日志 scope：`drag` 为拖动管线自身，`clamp` 沿用位置钳制的既有 scope。 */
export type DragLogScope = 'drag' | 'clamp'

export interface DragControllerOptions {
  /** 窗口外框物理坐标**缓存**（宿主用 onMoved 事件维护）；未就绪返回 null。 */
  getWindowPosition(): WindowPosition | null
  /** 异步查询窗口外框物理坐标：缓存缺失时兜底锚定，缓存命中时用于校正陈旧坐标。 */
  queryWindowPosition(): Promise<WindowPosition>
  /** 显示器矩形缓存（空数组表示未知：软钳制退化为 no-op）。 */
  getMonitorRects(): MonitorRect[]
  /** 异步补齐显示器矩形（缓存为空时调用，不阻塞拖动）。 */
  queryMonitorRects(): Promise<MonitorRect[]>
  /** 量测精灵 bbox（物理 px，相对窗口左上角）。 */
  measureSpriteBox(): SpriteBox
  /** 按物理 px 移动窗口（宿主转发 Tauri setPosition）。 */
  setWindowPosition(x: number, y: number): void
  /** screen CSS px → 物理 px 的换算比。 */
  getDevicePixelRatio(): number
  /** 帧调度（默认 requestAnimationFrame；测试注入手动泵）。 */
  scheduleFrame?(callback: () => void): void
  /** 诊断日志（宿主转投 petLog）。 */
  log?(scope: DragLogScope, message: string, data?: unknown): void
}

/** 一次松手/取消的结果（宿主据此决定是否刷新显示器缓存等）。 */
export interface DragResult {
  /** 本次手势实际应用的帧数。 */
  frames: number
  /** 最后一帧的窗口物理坐标；未发生拖动则为 null。 */
  x: number | null
  y: number | null
}

export interface DragController {
  pointerDown(event: DragPointerPoint & { button: number }): void
  pointerMove(event: DragPointerPoint): void
  /**
   * 松手。传入事件时把"松手坐标"当作最后一次移动的兜底——浏览器输入合并会把
   * 整段位移并进 up 事件（一个 `pointermove` 都不派发；实机快甩 3 次里出现 1 次），
   * 不兜底那次手势就是整段失效。
   */
  pointerUp(event?: DragPointerPoint): DragResult
  pointerCancel(): DragResult
  isDragging(): boolean
}

function defaultScheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback)
  else setTimeout(callback, 16)
}

export function createDragController(options: DragControllerOptions): DragController {
  const {
    getWindowPosition,
    queryWindowPosition,
    getMonitorRects,
    queryMonitorRects,
    measureSpriteBox,
    setWindowPosition,
    getDevicePixelRatio,
    scheduleFrame = defaultScheduleFrame,
    log = () => {},
  } = options

  interface Anchor {
    /** 按下瞬间的窗口外框物理坐标。 */
    winX: number
    winY: number
    /** 按下瞬间的光标屏幕坐标（CSS px）。 */
    screenX: number
    screenY: number
  }

  /** 按下序号：锚点落地时必须与当前序号一致（防串台）。 */
  let pressSeq = 0
  /** 本次按下的起点：client 坐标判阈值，screen 坐标定锚。 */
  let pressPoint: DragPointerPoint | null = null
  /** 最新光标位置——锚点未就绪时也照常记录，锚点一到即可补帧。 */
  let latestPoint: DragPointerPoint | null = null
  let anchor: Anchor | null = null
  let anchorSource: 'cache' | 'ipc' = 'cache'
  let clampContext: { monitors: MonitorRect[]; box: SpriteBox } | null = null
  let dragStarted = false
  /** 阈值已越过、只等锚点（缓存缺失的回退路径）。 */
  let pendingStart = false
  let framePending = false
  let frames = 0
  let lastApplied: WindowPosition | null = null
  let pressAt = 0

  /** 取钳制上下文：显示器优先用缓存，为空时异步补齐（不阻塞本次拖动）。 */
  function beginClampContext(): void {
    clampContext = { monitors: getMonitorRects(), box: measureSpriteBox() }
    if (clampContext.monitors.length > 0) return
    const seq = pressSeq
    void queryMonitorRects()
      .then((monitors) => {
        if (seq === pressSeq && clampContext !== null) clampContext.monitors = monitors
      })
      .catch(() => {
        // 显示器查询失败：本次拖动软钳制退化 no-op（与旧行为一致）。
      })
  }

  function applyFrame(): void {
    framePending = false
    if (!dragStarted || anchor === null || latestPoint === null) return
    const dpr = getDevicePixelRatio() || 1
    const rawX = Math.round(anchor.winX + (latestPoint.screenX - anchor.screenX) * dpr)
    const rawY = Math.round(anchor.winY + (latestPoint.screenY - anchor.screenY) * dpr)
    // 软钳制：拖动中精灵至少一半留在显示器并集内（monitors 为空时 no-op）。
    const clamped = clampContext !== null
      ? clampSpriteMinVisible(rawX, rawY, clampContext.box, clampContext.monitors)
      : { x: rawX, y: rawY }
    if (clampContext !== null && (clamped.x !== rawX || clamped.y !== rawY)) {
      // 只在钳制实际改变位置时记录，避免拖动每帧刷屏。
      log('clamp', 'drag soft-clamped', { x: rawX, y: rawY, clamped, monitors: clampContext.monitors.length })
    }
    lastApplied = clamped
    frames += 1
    setWindowPosition(clamped.x, clamped.y)
  }

  function queueFrame(): void {
    if (framePending) return
    framePending = true
    scheduleFrame(applyFrame)
  }

  function startDrag(trigger: 'move' | 'release'): void {
    dragStarted = true
    pendingStart = false
    log('drag', 'start', {
      source: anchorSource,
      trigger,
      latencyMs: Date.now() - pressAt,
      dpr: getDevicePixelRatio(),
      monitors: clampContext?.monitors.length ?? 0,
      // 锚点与按下坐标：出现"跟手偏差"时用于区分是锚点陈旧还是事件坐标异常。
      anchorX: anchor?.winX ?? null,
      anchorY: anchor?.winY ?? null,
      pressScreenX: pressPoint?.screenX ?? null,
      pressScreenY: pressPoint?.screenY ?? null,
    })
    queueFrame()
  }

  /** 相对按下点是否已越过起拖阈值（client 坐标，CSS px）。 */
  function thresholdCrossed(point: DragPointerPoint): boolean {
    if (pressPoint === null) return false
    return Math.hypot(point.clientX - pressPoint.clientX, point.clientY - pressPoint.clientY) >= DRAG_THRESHOLD_PX
  }

  function pointerDown(event: DragPointerPoint & { button: number }): void {
    if (event.button !== 0) return
    pressSeq += 1
    const seq = pressSeq
    pressPoint = {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
    }
    latestPoint = pressPoint
    anchor = null
    clampContext = null
    dragStarted = false
    pendingStart = false
    framePending = false
    frames = 0
    lastApplied = null
    pressAt = Date.now()

    const cached = getWindowPosition()
    if (cached !== null) {
      anchor = { winX: cached.x, winY: cached.y, screenX: event.screenX, screenY: event.screenY }
      anchorSource = 'cache'
      beginClampContext()
    }

    // 异步查询：缓存缺失时用它锚定（期间已越阈值的移动由 pendingStart 记下，不丢）；
    // 缓存命中时只用它在"首个应用帧之前"校正陈旧坐标——迟到即忽略，避免拖动中跳变。
    void queryWindowPosition()
      .then((pos) => {
        if (seq !== pressSeq || pressPoint === null) return
        if (anchor === null) {
          anchor = { winX: pos.x, winY: pos.y, screenX: pressPoint.screenX, screenY: pressPoint.screenY }
          anchorSource = 'ipc'
          beginClampContext()
          if (pendingStart) startDrag('move')
          return
        }
        if (lastApplied === null) {
          const dx = pos.x - anchor.winX
          const dy = pos.y - anchor.winY
          if (dx !== 0 || dy !== 0) {
            anchor.winX = pos.x
            anchor.winY = pos.y
            log('drag', 'anchor-refreshed', { dx, dy })
          }
        }
      })
      .catch((error) => {
        log('drag', 'anchor-failed', String(error))
      })
  }

  function pointerMove(event: DragPointerPoint): void {
    if (pressPoint === null) return
    latestPoint = {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
    }
    if (!dragStarted) {
      if (!thresholdCrossed(event)) return
      if (anchor === null) {
        // 锚点还没回来：先记下"已越阈值"，锚点落地即起拖补帧。
        pendingStart = true
        return
      }
      startDrag('move')
      return
    }
    queueFrame()
  }

  function pointerUp(event?: DragPointerPoint): DragResult {
    if (event !== undefined && pressPoint !== null) {
      latestPoint = {
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
      }
      // 输入合并兜底：整段位移只出现在 up 事件里（没有 pointermove）时，
      // 这里补起拖，随后 finish() 立即落帧。
      if (!dragStarted && anchor !== null && thresholdCrossed(event)) startDrag('release')
    }
    return finish()
  }

  function finish(): DragResult {
    if (dragStarted && latestPoint !== null && anchor !== null) {
      // 同步补最后一帧：松手即刻清状态，待处理的 rAF 到时已无意义——
      // 不补就会把"最后一次移动"的位移整段丢掉。
      applyFrame()
    }
    const result: DragResult = { frames, x: lastApplied?.x ?? null, y: lastApplied?.y ?? null }
    if (frames > 0) log('drag', 'end', { x: result.x, y: result.y, frames })
    pressSeq += 1 // 让在途的锚点查询失效
    pressPoint = null
    latestPoint = null
    anchor = null
    clampContext = null
    dragStarted = false
    pendingStart = false
    framePending = false
    frames = 0
    lastApplied = null
    return result
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel: finish,
    isDragging: () => dragStarted,
  }
}
