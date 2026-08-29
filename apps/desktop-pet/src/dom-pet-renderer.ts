/**
 * DOM 精灵渲染器（迁移自 CodexPetDesk 的 DOM 渲染技术）。
 *
 * 桌宠窗口用 DOM div（`background-image` + `background-position`）替代 Canvas
 * 画布，视觉与 CodexPetDesk 一致：像素渲染、drop-shadow、未加载占位框。
 * 帧选择仍走 `@yshark/pet-core` 的 `frameIndex`，状态→动画映射复用
 * renderer.ts 的 `animationNameForState`。
 */

import {
  ROW_FRAME_COUNTS,
  ROW_NAMES,
  cycleNext,
  frameIndex,
  type ParsedPet,
  type PetAnimationState,
} from '@yshark/pet-core'

import { animationNameForState } from './renderer.js'

/** 标准 Codex 宠物 atlas 单元格尺寸（8 列 × 9 行，192×208）。 */
export const CELL_WIDTH = 192
export const CELL_HEIGHT = 208
export const COLUMNS = 8
export const ROWS = 9

/** 解析不到宠物清单时的兜底动画表（标准 9 行 Codex atlas）。 */
export function buildFallbackStates(atlasRows = ROWS): Record<string, PetAnimationState> {
  const states: Record<string, PetAnimationState> = {}
  for (let row = 0; row < atlasRows; row++) {
    const name = ROW_NAMES[row] !== undefined ? ROW_NAMES[row] : `row-${row}`
    const frameCount = ROW_FRAME_COUNTS[row] !== undefined ? ROW_FRAME_COUNTS[row] : 8
    const playback = name === 'waving' || name === 'jumping' ? 'once' : 'loop'
    states[name] = {
      row,
      frameCount,
      timingMs: new Array<number>(frameCount).fill(140),
      playback,
      loop: playback === 'loop',
    }
  }
  return states
}

export interface DomPetRendererOptions {
  cellWidth?: number
  cellHeight?: number
  columns?: number
  /**
   * 渲染节流（ms）。0 或省略时用 requestAnimationFrame。
   * 仅当需要固定节流帧率时设置。
   */
  frameRate?: number
}

export interface DomPetRenderer {
  readonly element: HTMLElement
  setPet(pet: ParsedPet | null): void
  setSprite(url: string | null): void
  setState(state: string): void
  getState(): string
  setScale(scale: number): void
  getScale(): number
  /** 临时播放一次具名动画（如点击技能）。 */
  playAnimation(name: string): void
  /** 轮播到下一个宠物包声明的点击动画并播放。 */
  playNextClickSkill(): string | null
  getClickAnimation(): string | null
  render(now?: number): void
  start(): void
  stop(): void
  getAnimationName(): string
  dispose(): void
}

/**
 * 把显示态/交互态解析为 atlas 中的动画；不存在则回落 idle。
 * 纯函数，便于测试。
 */
export function resolveAnimation(
  state: string,
  states: Record<string, PetAnimationState>,
): PetAnimationState | undefined {
  return states[animationNameForState(state)] ?? states.idle
}

export function createDomPetRenderer(
  element: HTMLElement,
  options: DomPetRendererOptions = {},
): DomPetRenderer {
  const cellWidth = options.cellWidth ?? CELL_WIDTH
  const cellHeight = options.cellHeight ?? CELL_HEIGHT
  const columns = options.columns ?? COLUMNS
  const frameRate = options.frameRate ?? 0

  let states: Record<string, PetAnimationState> = buildFallbackStates()
  let clickAnimations: string[] = []
  let stateName = 'idle'
  let frame = 0
  let animationStartedAt = 0
  let scale = 1
  let raf = 0
  let interval: ReturnType<typeof setTimeout> | null = null
  let running = false
  let lastClickSkill: string | null = null

  function rows(): number {
    let max = 1
    for (const anim of Object.values(states)) {
      if (anim.row + 1 > max) max = anim.row + 1
    }
    return max
  }

  function paint(): void {
    const anim = states[stateName] ?? states.idle
    if (!anim) return
    const x = frame * cellWidth * scale
    const y = anim.row * cellHeight * scale
    element.style.backgroundPosition = `-${x}px -${y}px`
  }

  function applyScale(): void {
    element.style.width = `${cellWidth * scale}px`
    element.style.height = `${cellHeight * scale}px`
    element.style.backgroundSize =
      `${cellWidth * columns * scale}px ${cellHeight * rows() * scale}px`
  }

  function setState(next: string): void {
    const resolved = animationNameForState(next)
    if (states[resolved] === undefined) return
    if (stateName === resolved) return
    stateName = resolved
    frame = 0
    animationStartedAt = performance.now()
    paint()
  }

  function setPet(pet: ParsedPet | null): void {
    states = pet?.states ?? buildFallbackStates()
    clickAnimations = pet?.clickAnimations ?? []
    lastClickSkill = null
    stateName = 'idle'
    frame = 0
    animationStartedAt = performance.now()
    applyScale()
    paint()
  }

  function setSprite(url: string | null): void {
    if (url) {
      element.style.backgroundImage = `url("${url}")`
      element.classList.add('is-loaded')
    } else {
      element.style.backgroundImage = ''
      element.classList.remove('is-loaded')
    }
  }

  function setScale(next: number): void {
    scale = next
    applyScale()
    paint()
  }

  function render(now?: number): void {
    const anim = states[stateName] ?? states.idle
    if (!anim) return
    const elapsed = (now ?? performance.now()) - animationStartedAt
    const result = frameIndex(anim, elapsed)
    if (result.finished && anim.playback === 'once') {
      // 一次性动画（waving/jumping/点击技能）播完回到 idle。
      setState('idle')
      return
    }
    if (result.frame !== frame) {
      frame = result.frame
      paint()
    }
  }

  function playAnimation(name: string): void {
    if (states[name] === undefined) return
    stateName = name
    frame = 0
    animationStartedAt = performance.now()
    paint()
  }

  function playNextClickSkill(): string | null {
    const next = cycleNext(lastClickSkill, clickAnimations)
    if (next !== null) {
      lastClickSkill = next
      playAnimation(next)
    }
    return next
  }

  function tick(): void {
    if (!running) return
    render()
    if (frameRate > 0) {
      interval = setTimeout(tick, frameRate) as unknown as ReturnType<typeof setTimeout>
    } else {
      raf = requestAnimationFrame(tick)
    }
  }

  function start(): void {
    if (running) return
    running = true
    if (frameRate > 0) {
      tick()
    } else if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(tick)
    }
  }

  function stop(): void {
    running = false
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    raf = 0
    if (interval !== null) {
      clearTimeout(interval)
      interval = null
    }
  }

  function dispose(): void {
    stop()
    element.classList.remove('is-loaded')
  }

  return {
    element,
    setPet,
    setSprite,
    setState,
    getState: () => stateName,
    setScale,
    getScale: () => scale,
    playAnimation,
    playNextClickSkill,
    getClickAnimation: () => lastClickSkill,
    render,
    start,
    stop,
    getAnimationName: () => stateName,
    dispose,
  }
}
