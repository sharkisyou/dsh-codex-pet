/**
 * Canvas 2D pet renderer.
 *
 * The renderer is intentionally small and browser-only: it takes a parsed pet
 * package and the current display state from the server read model, then draws
 * the correct atlas frame on a canvas. It uses pet-core's pure animation frame
 * selection so the desktop app and tests share the same timing logic.
 */

import {
  cycleNext,
  frameIndex,
  type ParsedPet,
  type PetAnimationState,
} from '@yshark/pet-core'

export const STATE_ANIMATION: Readonly<Record<string, string>> = Object.freeze({
  idle: 'idle',
  running: 'running',
  working: 'running',
  waiting: 'waiting',
  blocked: 'failed',
  failed: 'failed',
  ready: 'review',
  // 交互态（悬停/移动/挥手）：atlas 中存在对应行时原样透传，
  // 否则 currentAnimationName 会回落到 idle。
  jumping: 'jumping',
  waving: 'waving',
  'running-left': 'running-left',
  'running-right': 'running-right',
})

export const BUBBLE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  idle: '空闲',
  awaitingReply: '等待回复',
  thinking: '思考中',
  executingTool: '执行工具',
  waitingApproval: '等待批准',
  waitingAnswer: '等待回答',
  planReview: '计划审阅',
  subagentWorking: '子代理工作中',
  failed: '失败',
  ready: '就绪',
  review: '待查看',
  waitingInput: '等待输入',
})

export function animationNameForState(state: string): string {
  return STATE_ANIMATION[state] ?? 'idle'
}

export function nextClickSkill(
  current: string | null | undefined,
  list: readonly string[] | null | undefined,
): string | null {
  return cycleNext(current, list)
}

export function bubbleText(
  key: string | null | undefined,
  params?: Record<string, unknown> | null,
  lang: 'zh' | 'en' = 'zh',
): string {
  const fallback = key === 'executingTool' ? '执行工具' : '空闲'
  const text = key ? BUBBLE_TEXT[key] ?? fallback : fallback
  if (lang === 'en') {
    const en: Record<string, string> = {
      idle: 'Idle',
      awaitingReply: 'Waiting for reply',
      thinking: 'Thinking',
      executingTool: 'Running tool',
      waitingApproval: 'Waiting for approval',
      waitingAnswer: 'Waiting for answer',
      planReview: 'Reviewing plan',
      subagentWorking: 'Subagent working',
      failed: 'Failed',
      ready: 'Done',
      review: 'Ready to review',
      waitingInput: 'Waiting for input',
    }
    const enText = en[key ?? 'idle'] ?? text
    if (key === 'executingTool' && params && typeof params.name === 'string' && params.name !== '') {
      return `${enText}: ${params.name}`
    }
    return enText
  }
  if (key === 'executingTool' && params && typeof params.name === 'string' && params.name !== '') {
    return `${text}: ${params.name}`
  }
  return text
}

export interface PetRendererOptions {
  /** Animation refresh interval in ms. Defaults to requestAnimationFrame when available. */
  frameRate?: number
  fallbackColor?: string
  /** Number of rows in the atlas. Defaults to the highest pet state row + 1. */
  atlasRows?: number
  /** Number of columns in the atlas. Defaults to 8, the standard pet atlas width. */
  columns?: number
  /**
   * Whether the renderer draws the speech bubble onto the canvas. Defaults to
   * true. Hosts that render a DOM speech bubble on top (e.g. the pet window
   * shell) should set this to false to avoid a duplicated bubble.
   */
  drawBubble?: boolean
}

export interface PetRenderer {
  setPet(pet: ParsedPet | null): void
  setSprite(source: string | HTMLImageElement | null): void
  setImage(image: HTMLImageElement | null): void
  setState(state: string): void
  setBubble(key: string | null, params?: Record<string, unknown> | null): void
  /** Temporarily play a named animation from the pet package (e.g. a click skill). */
  playAnimation(name: string): void
  /** Advance to the next package-declared click animation and play it. */
  playNextClickSkill(): string | null
  /** Alias for {@link PetRenderer.playNextClickSkill}. */
  playClickSkill(): string | null
  /** Alias for {@link PetRenderer.playNextClickSkill}. */
  playClickAnimation(): string | null
  /** Alias for {@link PetRenderer.playNextClickSkill}. */
  triggerClickSkill(): string | null
  /** The currently active override animation, if any. */
  getClickAnimation(): string | null
  start(): void
  stop(): void
  render(now?: number): void
  readonly animationName: string
  readonly canvas: HTMLCanvasElement
  getAnimationName(): string
  getState(): string
  getBubble(): { key: string | null; params: Record<string, unknown> | null }
}

interface RendererState {
  pet: ParsedPet | null
  sprite: HTMLImageElement | null
  spriteSource: string | null
  state: string
  bubbleKey: string | null
  bubbleParams: Record<string, unknown> | null
  animationName: string
  animationStartedAt: number
  overrideAnimation: string | null
  lastClickSkill: string | null
}

function fallbackDraw(ctx: CanvasRenderingContext2D, width: number, height: number, state: string, color: string): void {
  const palette: Record<string, string> = {
    idle: '#8ecae6',
    running: '#95d5b2',
    waiting: '#f9c74f',
    blocked: '#f94144',
    failed: '#f94144',
    ready: '#90be6d',
  }
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = 'rgba(0, 0, 0, 1)'
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = palette[state] ?? color
  const size = Math.min(width, height) * 0.5
  ctx.beginPath()
  ctx.arc(width / 2, height / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `${Math.max(10, Math.floor(size * 0.22))}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(state === 'blocked' || state === 'failed' ? '!' : '•', width / 2, height / 2)
}

export function createPetRenderer(
  canvas: HTMLCanvasElement,
  options: PetRendererOptions = {},
): PetRenderer {
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null
  const frameRate = options.frameRate ?? 0
  const fallbackColor = options.fallbackColor ?? '#8ecae6'
  const drawBubbleCanvas = options.drawBubble !== false

  const state: RendererState = {
    pet: null,
    sprite: null,
    spriteSource: null,
    state: 'idle',
    bubbleKey: 'idle',
    bubbleParams: null,
    animationName: 'idle',
    animationStartedAt: 0,
    overrideAnimation: null,
    lastClickSkill: null,
  }

  let raf = 0
  let interval: ReturnType<typeof setInterval> | null = null
  let running = false

  function setPet(pet: ParsedPet | null): void {
    state.pet = pet
    state.overrideAnimation = null
    state.lastClickSkill = null
    state.animationStartedAt = performance.now()
    state.animationName = animationNameForState(state.state)
  }

  function setImage(image: HTMLImageElement | null): void {
    state.sprite = image
    state.spriteSource = null
    state.animationStartedAt = performance.now()
  }

  function setSprite(source: string | HTMLImageElement | null): void {
    if (source === null || typeof source !== 'string') {
      setImage(source as HTMLImageElement | null)
      return
    }
    if (state.spriteSource === source) return
    state.spriteSource = source
    if (typeof Image === 'undefined') return
    const image = new Image()
    image.onload = () => {
      if (state.spriteSource === source) state.sprite = image
    }
    image.src = source
  }

  function setState(next: string): void {
    if (state.state === next && state.overrideAnimation === null) return
    state.state = next
    state.overrideAnimation = null
    state.animationName = animationNameForState(next)
    state.animationStartedAt = performance.now()
  }

  function setBubble(key: string | null, params?: Record<string, unknown> | null): void {
    state.bubbleKey = key
    state.bubbleParams = params ?? null
  }

  function currentAnimationName(): string {
    if (state.overrideAnimation !== null && state.pet !== null && state.pet.states[state.overrideAnimation] !== undefined) {
      return state.overrideAnimation
    }
    const base = animationNameForState(state.state)
    if (state.pet !== null && state.pet.states[base] !== undefined) return base
    return state.pet !== null && state.pet.states.idle !== undefined ? 'idle' : 'idle'
  }

  function playAnimation(name: string): void {
    if (state.pet === null || state.pet.states[name] === undefined) return
    state.overrideAnimation = name
    state.animationName = name
    state.animationStartedAt = performance.now()
  }

  function playNextClickSkill(): string | null {
    if (state.pet === null) return null
    const list = state.pet.clickAnimations ?? []
    const next = nextClickSkill(state.lastClickSkill, list)
    if (next !== null) {
      state.lastClickSkill = next
      playAnimation(next)
    }
    return next
  }

  function getClickAnimation(): string | null {
    return state.overrideAnimation
  }

  function render(now?: number): void {
    if (!ctx) return
    const width = canvas.width
    const height = canvas.height
    if (width <= 0 || height <= 0) return

    const animName = currentAnimationName()
    if (state.animationName !== animName) {
      state.animationName = animName
      state.animationStartedAt = now ?? performance.now()
    }
    const elapsed = (now ?? performance.now()) - state.animationStartedAt

    const pet = state.pet
    const sprite = state.sprite
    const spriteWidth = (sprite as any)?.naturalWidth || (sprite as any)?.width || 0
    const spriteHeight = (sprite as any)?.naturalHeight || (sprite as any)?.height || 0
    if (pet === null || sprite === null || sprite.complete === false || spriteWidth === 0 || spriteHeight === 0) {
      fallbackDraw(ctx, width, height, state.state, fallbackColor)
      if (drawBubbleCanvas) drawBubble(ctx, width, height)
      return
    }

    const anim: PetAnimationState | undefined = pet.states[animName]
    if (anim === undefined) {
      fallbackDraw(ctx, width, height, state.state, fallbackColor)
      if (drawBubbleCanvas) drawBubble(ctx, width, height)
      return
    }

    const frameResult = frameIndex(anim, elapsed)
    const frame = frameResult.frame
    if (state.overrideAnimation !== null && frameResult.finished) {
      state.overrideAnimation = null
      state.animationName = animationNameForState(state.state)
      state.animationStartedAt = now ?? performance.now()
    }
    const columns = options.columns ?? 8
    const rows = options.atlasRows ?? Math.max(
      1,
      ...Object.values(pet.states).map((value) => value.row + 1),
    )
    const cellWidth = spriteWidth / columns
    const cellHeight = spriteHeight / rows
    // 透明窗口下部分 WebKit 对 clearRect 的透明清除不可靠，先用
    // destination-out 强制擦除上一帧，避免旧宠物/占位圆残留。
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0, 0, 0, 1)'
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
    ctx.clearRect(0, 0, width, height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      sprite,
      frame * cellWidth,
      anim.row * cellHeight,
      cellWidth,
      cellHeight,
      0,
      0,
      width,
      height,
    )
    if (drawBubbleCanvas) drawBubble(ctx, width, height)
  }

  function drawBubble(context: CanvasRenderingContext2D, width: number, _height: number): void {
    const text = bubbleText(state.bubbleKey, state.bubbleParams)
    if (!text) return
    const padding = 6
    const fontSize = Math.max(10, Math.min(14, Math.floor(width / 10)))
    context.font = `${fontSize}px system-ui, sans-serif`
    const metrics = context.measureText(text)
    const boxWidth = metrics.width + padding * 2
    const boxHeight = fontSize + padding * 2
    const x = Math.max(2, Math.min(width - boxWidth - 2, (width - boxWidth) / 2))
    const y = 4
    context.fillStyle = 'rgba(30,30,30,0.82)'
    context.beginPath()
    if (typeof context.roundRect === 'function') {
      context.roundRect(x, y, boxWidth, boxHeight, 6)
    } else {
      context.rect(x, y, boxWidth, boxHeight)
    }
    context.fill()
    context.fillStyle = '#fff'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText(text, x + padding, y + boxHeight / 2 + 1)
  }

  function tick(): void {
    render()
    if (running && frameRate > 0) {
      interval = setTimeout(tick, frameRate) as unknown as ReturnType<typeof setInterval>
    }
  }

  function start(): void {
    if (running) return
    running = true
    if (frameRate > 0) {
      tick()
    } else if (typeof requestAnimationFrame === 'function') {
      const loop = (): void => {
        if (!running) return
        render()
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    } else {
      tick()
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

  function getAnimationName(): string {
    return state.animationName
  }

  function getState(): string {
    return state.state
  }

  function getBubble(): { key: string | null; params: Record<string, unknown> | null } {
    return { key: state.bubbleKey, params: state.bubbleParams }
  }

  const renderer: PetRenderer = {
    canvas,
    setPet,
    setSprite,
    setImage,
    setState,
    setBubble,
    playAnimation,
    playNextClickSkill,
    playClickSkill: playNextClickSkill,
    playClickAnimation: playNextClickSkill,
    triggerClickSkill: playNextClickSkill,
    getClickAnimation,
    start,
    stop,
    render,
    get animationName() { return state.animationName },
    getAnimationName,
    getState,
    getBubble,
  }
  Object.setPrototypeOf(renderer, createPetRenderer.prototype)
  return renderer
}

export const FALLBACK_COLORS = Object.freeze({
  idle: '#8ecae6',
  running: '#95d5b2',
  waiting: '#f9c74f',
  blocked: '#f94144',
  failed: '#f94144',
  ready: '#90be6d',
})

/** Alias for callers that like the "state -> animation" wording. */
export const stateToAnimation = animationNameForState
export const displayAnimation = animationNameForState

/** Short alias for the Canvas renderer factory. */
export const createRenderer = createPetRenderer

export default createPetRenderer

/** Class-like value alias so `new PetRenderer(canvas)` also works. */
export const PetRenderer = createPetRenderer
