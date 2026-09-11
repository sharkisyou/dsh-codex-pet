/**
 * DOM 精灵渲染器（迁移自 CodexPetDesk 的 DOM 渲染技术）。
 *
 * 桌宠窗口用 DOM div（`background-image` + `background-position`）替代 Canvas
 * 画布，视觉与 CodexPetDesk 一致：像素渲染、drop-shadow、未加载占位框。
 * 帧选择仍走 `@yshark/pet-core` 的 `frameIndex`，状态→动画映射复用
 * renderer.ts 的 `animationNameForState`。
 */

import {
  FALLBACK_FRAME_MS,
  ROW_FRAME_COUNTS,
  ROW_NAMES,
  cycleNext,
  frameIndex,
  totalDuration,
  type AnimationDefinition,
  type ParsedPet,
  type PetAnimationState,
} from '@yshark/pet-core'

import { animationNameForState } from './renderer.js'
import { petLog } from './pet-log.js'

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

/** 定时唤醒的下限/上限（ms）：避免忙循环，也避免异常 timing 导致长时间不刷新。 */
export const MIN_WAKE_MS = 4
export const MAX_WAKE_MS = 1000

/**
 * 距离"下一帧边界"还剩多少毫秒（纯函数）。
 *
 * 渲染器不再用 requestAnimationFrame 每 16ms 空转：图集帧时长通常是 140ms 量级，
 * 按边界唤醒就够（宠物窗渲染进程之前那 ~3-4% 单核占用主要来自这种空转）。
 * 单帧动画没有边界可言，退化为 `MAX_WAKE_MS` 长睡。
 */
export function nextFrameDelayMs(anim: AnimationDefinition, elapsedMs: number): number {
  const count = anim.frameCount
  if (count <= 1) return MAX_WAKE_MS
  const total = totalDuration(anim.timingMs, count)
  if (total <= 0) return MAX_WAKE_MS
  const once = anim.playback === 'once' || anim.loop === false
  // 一次性动画已播完：render() 会切回 idle，这里长睡等下一次 setState。
  if (once && elapsedMs >= total) return MAX_WAKE_MS
  const pos = elapsedMs < 0 ? 0 : elapsedMs % total
  let acc = 0
  for (let i = 0; i < count; i++) {
    acc += anim.timingMs?.[i] !== undefined ? (anim.timingMs as readonly number[])[i] : FALLBACK_FRAME_MS
    if (pos < acc) return clampWake(acc - pos)
  }
  return clampWake(total - pos)
}

function clampWake(ms: number): number {
  if (!Number.isFinite(ms)) return MAX_WAKE_MS
  return Math.min(MAX_WAKE_MS, Math.max(MIN_WAKE_MS, Math.ceil(ms)))
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
  /**
   * 轮播到下一个动作并播放：优先宠物包声明的点击技能（clickAnimations），
   * 未声明时轮播全部动画状态（idle/running/waving/jumping/...）。
   * 点击一次播放下一个，循环播放。
   */
  playNextAnimation(): string | null
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

/**
 * 计算"点击一次后播放下一个动作"的名字（纯函数，便于测试）。
 *
 * 规则：
 * - 宠物包声明了点击技能（clickAnimations 非空）→ 轮播声明列表（保持
 *   "点击技能"语义；未在列表中时从头开始）。
 * - 未声明 → 轮播全部动画状态（idle/running/waving/jumping/...），
 *   点击一次播放下一个，循环播放；未在状态表中时从头开始。
 * - 两者都为空 → null（无可播放动作）。
 */
export function nextAnimationName(
  current: string | null | undefined,
  clickAnimations: readonly string[] | null | undefined,
  states: Record<string, PetAnimationState>,
): string | null {
  const declared = cycleNext(current, clickAnimations)
  if (declared !== null) return declared
  const all = Object.keys(states).filter((name) => states[name] !== undefined)
  if (all.length === 0) return null
  const index = all.indexOf(current as string)
  if (index < 0) return all[0]
  return all[(index + 1) % all.length]
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
    const exists = states[resolved] !== undefined
    if (!exists) {
      // 图集没有该动画行：明确回落 idle，而不是静默停留在旧姿势（旧姿势可能
      // 与真实状态不符，如任务已完成却仍摆着 running）。日志便于排查。
      petLog('renderer', 'setState animation missing → idle', { next, resolved, previous: stateName })
      if (states.idle === undefined) return
      if (stateName === 'idle') return
      stateName = 'idle'
      frame = 0
      animationStartedAt = performance.now()
      element.dataset.state = next
      element.dataset.anim = 'idle'
      paint()
      return
    }
    petLog('renderer', 'setState', { next, resolved, previous: stateName })
    if (stateName === resolved) return
    stateName = resolved
    frame = 0
    animationStartedAt = performance.now()
    element.dataset.state = next
    element.dataset.anim = resolved
    paint()
  }

  function setPet(pet: ParsedPet | null): void {
    states = pet?.states ?? buildFallbackStates()
    clickAnimations = pet?.clickAnimations ?? []
    lastClickSkill = null
    lastAnimation = null
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

  /** 所有动画状态的键（用于无点击声明时轮播全部动作）。 */
  let lastAnimation: string | null = null

  function playNextAnimation(): string | null {
    // 宠物包声明了点击技能 → 优先轮播声明列表（保持原有"点击技能"语义）。
    const next = nextAnimationName(lastAnimation, clickAnimations, states)
    if (next !== null) {
      lastAnimation = next
      playAnimation(next)
    }
    return next
  }

  /** 下一次唤醒的间隔：显式 frameRate 优先，否则按当前动画的下一帧边界。 */
  function nextDelay(): number {
    if (frameRate > 0) return frameRate
    const anim = states[stateName] ?? states.idle
    if (!anim) return MAX_WAKE_MS
    return nextFrameDelayMs(anim, performance.now() - animationStartedAt)
  }

  function tick(): void {
    if (!running) return
    render()
    interval = setTimeout(tick, nextDelay()) as unknown as ReturnType<typeof setTimeout>
  }

  function start(): void {
    if (running) return
    running = true
    tick()
  }

  function stop(): void {
    running = false
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
    playNextAnimation,
    getClickAnimation: () => lastClickSkill,
    render,
    start,
    stop,
    getAnimationName: () => stateName,
    dispose,
  }
}
