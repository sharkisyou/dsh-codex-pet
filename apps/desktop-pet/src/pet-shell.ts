/**
 * 桌宠窗口外壳交互（迁移自 CodexPetDesk src/main.js 的界面部分，重写为 TS）。
 *
 * 只负责桌宠窗口的“壳”：DOM 说话气泡、悬停跳跃、Ctrl+滚轮/双指缩放、
 * 窗口拖动时的跑动动画、右键菜单。精灵帧动画仍由 Canvas renderer 承担，
 * 因此本模块不复制任何渲染逻辑。
 */

import type { PetRenderer } from './renderer.js'
import { escapeHtml } from './ui-utils.js'

export const MIN_SCALE = 0.4
export const MAX_SCALE = 3
export const WHEEL_SCALE_STEP = 0.08
export const BUBBLE_DEFAULT_TIMEOUT = 8500
export const MOVE_SETTLE_MS = 180
export const DRAG_MOVE_DELTA_PX = 1

export function clampScale(value: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, value))
}

/** 纯函数：根据滚轮 deltaY 得到缩放方向（向上滚 +1，向下滚 -1）。 */
export function wheelZoomDirection(deltaY: number): 1 | -1 {
  return deltaY < 0 ? 1 : -1
}

export interface SpeechBubbleOptions {
  title?: string
  message?: string
  state?: string
  timeout?: number
}

export interface PetShellOptions {
  /** 宠物元素（悬停与右键目标）。 */
  element: HTMLElement
  /** DOM 说话气泡元素。 */
  bubbleEl: HTMLElement
  /** 右键菜单元素（默认 hidden）。 */
  contextMenuEl?: HTMLElement | null
  /** 当前缩放比例。 */
  getScale(): number
  /** 应用新缩放（宿主负责画布与窗口尺寸）。 */
  setScale(scale: number): void
  /** 渲染器，用于悬停/移动时的动画状态切换。 */
  renderer: Pick<PetRenderer, 'setState'>
  /** 右键菜单“设置”。 */
  onOpenSettings?: () => void
  /** 右键菜单“隐藏”。 */
  onHide?: () => void
  /**
   * 气泡自动隐藏后的回调（宿主恢复状态）。未提供时默认在未悬停时回到
   * idle，与 CodexPetDesk 行为一致。
   */
  onBubbleHide?: () => void
}

export interface PetShell {
  showBubble(options: SpeechBubbleOptions): void
  hideBubble(): void
  /** 通知横向位移（窗口被拖动），用于播放跑动动画。 */
  onWindowMoved(nextX: number): void
  isHovered(): boolean
  dispose(): void
}

interface TouchPinch {
  distance: number
  scale: number
}

export function mountPetShell(options: PetShellOptions): PetShell {
  const {
    element,
    bubbleEl,
    contextMenuEl = null,
    getScale,
    setScale,
    renderer,
    onOpenSettings,
    onHide,
    onBubbleHide,
  } = options

  let hovered = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null
  let lastWindowX: number | null = null
  let pinch: TouchPinch | null = null

  function clearSettleTimer(): void {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  function startSettleTimer(): void {
    clearSettleTimer()
    settleTimer = setTimeout(() => {
      settleTimer = null
      lastWindowX = null
      renderer.setState(hovered ? 'jumping' : 'idle')
    }, MOVE_SETTLE_MS)
  }

  function showBubble({ title = '', message = '', state, timeout = BUBBLE_DEFAULT_TIMEOUT }: SpeechBubbleOptions = {}): void {
    bubbleEl.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    `
    bubbleEl.closest('.shell')?.classList.add('has-bubble')
    if (state) renderer.setState(state)
    if (bubbleTimer !== null) clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(hideBubble, timeout)
  }

  function hideBubble(): void {
    if (bubbleTimer !== null) {
      clearTimeout(bubbleTimer)
      bubbleTimer = null
    }
    bubbleEl.closest('.shell')?.classList.remove('has-bubble')
    bubbleEl.textContent = ''
    if (onBubbleHide) {
      onBubbleHide()
    } else if (!hovered) {
      renderer.setState('idle')
    }
  }

  function onWindowMoved(nextX: number): void {
    if (!Number.isFinite(nextX)) return
    if (lastWindowX !== null) {
      const deltaX = nextX - lastWindowX
      if (Math.abs(deltaX) >= DRAG_MOVE_DELTA_PX) {
        renderer.setState(deltaX > 0 ? 'running-right' : 'running-left')
      }
    }
    lastWindowX = nextX
    startSettleTimer()
  }

  function updateScale(next: number): void {
    setScale(clampScale(next))
  }

  function onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return
    event.preventDefault()
    updateScale(getScale() + wheelZoomDirection(event.deltaY) * WHEEL_SCALE_STEP)
  }

  function touchDistance(first: Touch, second: Touch): number {
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
  }

  function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 2) return
    event.preventDefault()
    const distance = touchDistance(event.touches[0], event.touches[1])
    if (distance <= 0) return
    pinch = { distance, scale: getScale() }
  }

  function onTouchMove(event: TouchEvent): void {
    if (!pinch || event.touches.length < 2) return
    event.preventDefault()
    const distance = touchDistance(event.touches[0], event.touches[1])
    if (distance <= 0) return
    updateScale(pinch.scale * (distance / pinch.distance))
  }

  function onTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) pinch = null
  }

  /* ---------- 右键菜单 ---------- */

  function showContextMenu(x: number, y: number): void {
    if (!contextMenuEl) return
    contextMenuEl.hidden = false
    const rect = contextMenuEl.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    contextMenuEl.style.left = `${left}px`
    contextMenuEl.style.top = `${top}px`
  }

  function hideContextMenu(): void {
    if (contextMenuEl) contextMenuEl.hidden = true
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault()
    showContextMenu(event.clientX, event.clientY)
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    if (!contextMenuEl || contextMenuEl.hidden) return
    if (contextMenuEl.contains(event.target as Node)) return
    hideContextMenu()
  }

  /* ---------- 具名事件处理器（供 dispose 解绑） ---------- */

  function onMouseEnter(): void {
    hovered = true
    if (!settleTimer) renderer.setState('jumping')
  }

  function onMouseLeave(): void {
    hovered = false
    if (!settleTimer) renderer.setState('idle')
  }

  function onSettingsClick(): void {
    hideContextMenu()
    onOpenSettings?.()
  }

  function onHideClick(): void {
    hideContextMenu()
    onHide?.()
  }

  /* ---------- 事件绑定 ---------- */

  element.addEventListener('mouseenter', onMouseEnter)
  element.addEventListener('mouseleave', onMouseLeave)
  element.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('touchstart', onTouchStart, { passive: false })
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onTouchEnd)
  document.addEventListener('touchcancel', onTouchEnd)
  document.addEventListener('pointerdown', onDocumentPointerDown)

  const settingsButton = contextMenuEl?.querySelector<HTMLButtonElement>('#pet-menu-settings')
  const hideButton = contextMenuEl?.querySelector<HTMLButtonElement>('#pet-menu-hide')
  settingsButton?.addEventListener('click', onSettingsClick)
  hideButton?.addEventListener('click', onHideClick)

  function dispose(): void {
    clearSettleTimer()
    if (bubbleTimer !== null) {
      clearTimeout(bubbleTimer)
      bubbleTimer = null
    }
    element.removeEventListener('mouseenter', onMouseEnter)
    element.removeEventListener('mouseleave', onMouseLeave)
    element.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('wheel', onWheel)
    document.removeEventListener('touchstart', onTouchStart)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
    document.removeEventListener('touchcancel', onTouchEnd)
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    settingsButton?.removeEventListener('click', onSettingsClick)
    hideButton?.removeEventListener('click', onHideClick)
  }

  return {
    showBubble,
    hideBubble,
    onWindowMoved,
    isHovered: () => hovered,
    dispose,
  }
}
