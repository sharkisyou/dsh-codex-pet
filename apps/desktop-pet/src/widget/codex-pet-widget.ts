/**
 * 可嵌入网页的悬浮桌宠 Web Component。
 *
 * 迁移自 CodexPetDesk `src/widget/codex-pet-widget.js`，重写为 TypeScript，
 * 并改用 `@yshark/pet-core` 的 `parsePetJson` / `frameIndex` 做清单解析与
 * 帧选择（不再硬编码动画表）。
 *
 * 用法：
 *   <script src="/codex-pet-widget.js"></script>
 *   <script>
 *     CodexPet.mount({ pet: "/pets/hachiroku/pet.json", position: "bottom-right", scale: 0.85 });
 *   </script>
 * 或作为模块：
 *   import { mount } from "/codex-pet-widget.es.js";
 *   mount({ pet: "/pets/hachiroku/pet.json" });
 */

import {
  frameIndex,
  parsePetJson,
  type ParsedPet,
  type PetAnimationState,
} from '@yshark/pet-core'
import { clamp, escapeHtml } from '../ui-utils.js'
import { CELL_WIDTH, CELL_HEIGHT, COLUMNS, ROWS, buildFallbackStates } from '../dom-pet-renderer.js'

export { clamp } from '../ui-utils.js'
export { CELL_WIDTH, CELL_HEIGHT, COLUMNS, ROWS, buildFallbackStates } from '../dom-pet-renderer.js'

export const MIN_SCALE = 0.45
export const MAX_SCALE = 2.5
export const MIN_RENDER_SCALE = 0.36
export const WHEEL_SCALE_STEP = 0.08
export const MOBILE_VIEWPORT = 360
export const DESKTOP_VIEWPORT = 768
export const MIN_AUTO_SCALE_FACTOR = 0.64
export const BUBBLE_MAX_WIDTH = 252
export const BUBBLE_MIN_WIDTH = 176
export const BUBBLE_HEIGHT = 84
export const DESKTOP_EDGE_OFFSET = 24
export const MOBILE_EDGE_OFFSET = 12
export const BUBBLE_DEFAULT_TIMEOUT = 8500

export function readNumber(value: string | number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** 解析 spritesheet 的绝对地址（相对清单地址解析）。 */
export function resolveSpriteUrl(src: string, spritesheetPath: string, baseURI?: string): string {
  const base = baseURI ?? (typeof document !== 'undefined' ? document.baseURI : undefined)
  const manifestUrl = base !== undefined ? new URL(src, base) : new URL(src)
  return new URL(spritesheetPath || 'spritesheet.webp', manifestUrl).href
}

const SHADOW_CSS = `
  :host {
    --codex-pet-z-index: 2147483000;
    --codex-pet-inline: 24px;
    --codex-pet-block: 24px;
    --codex-pet-stage-width: 252px;
    --codex-pet-bubble-width: 252px;
    position: fixed;
    z-index: var(--codex-pet-z-index);
    display: block;
    width: 252px;
    height: 290px;
    color: #111827;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none;
    touch-action: none;
    overscroll-behavior: contain;
  }

  :host([position="bottom-right"]) { right: var(--codex-pet-inline); bottom: var(--codex-pet-block); }
  :host([position="bottom-left"]) { left: var(--codex-pet-inline); bottom: var(--codex-pet-block); }
  :host([position="top-right"]) { right: var(--codex-pet-inline); top: var(--codex-pet-block); }
  :host([position="top-left"]) { left: var(--codex-pet-inline); top: var(--codex-pet-block); }

  .stage {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 8px;
    min-width: var(--codex-pet-stage-width);
    pointer-events: none;
  }

  .bubble {
    display: grid;
    gap: 2px;
    width: var(--codex-pet-bubble-width);
    max-height: 72px;
    padding: 8px 10px;
    border: 1px solid rgb(15 23 42 / 0.08);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.94);
    box-shadow: 0 10px 28px rgb(15 23 42 / 0.18);
    font-size: 12px;
    line-height: 1.28;
    opacity: 0;
    overflow: hidden;
    transform: translateY(8px);
    transition: opacity 160ms ease, transform 160ms ease;
  }

  .bubble.is-visible { opacity: 1; transform: translateY(0); }

  .bubble strong,
  .bubble span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .bubble strong { font-size: 13px; font-weight: 800; -webkit-line-clamp: 1; }
  .bubble span { color: rgb(17 24 39 / 0.78); -webkit-line-clamp: 2; }

  .pet {
    image-rendering: pixelated;
    background-repeat: no-repeat;
    filter: drop-shadow(0 12px 12px rgb(0 0 0 / 0.26));
    cursor: grab;
    pointer-events: auto;
    -webkit-user-drag: none;
  }

  .pet:active { cursor: grabbing; }
`

interface DragState {
  pointerId: number
  offsetX: number
  offsetY: number
  lastX: number
}

interface PinchState {
  distance: number
  scale: number
}

function pointerPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY }
}

function firstTwoPointers(pointerMap: Map<number, { x: number; y: number }>): Array<{ x: number; y: number }> {
  return [...pointerMap.values()].slice(0, 2)
}

function pointDistance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function pointCenter(first: { x: number; y: number }, second: { x: number; y: number }): { x: number; y: number } {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

/**
 * Node 测试环境没有 DOM：模块顶层不能直接 `extends HTMLElement`。
 * 浏览器里用真实 HTMLElement，Node 里退化为空基类（纯函数测试仍可用）。
 */
const BaseElement = (typeof HTMLElement !== 'undefined' ? HTMLElement : class {}) as typeof HTMLElement

export class CodexPetElement extends BaseElement {
  private petEl!: HTMLElement
  private bubbleEl!: HTMLElement
  private states: Record<string, PetAnimationState>
  private scale: number
  private renderScale: number
  private stateName: string
  private frame = 0
  private frameTimer = 0
  private lastTimestamp = 0
  private rafId = 0
  private drag: DragState | null = null
  private activePointers = new Map<number, { x: number; y: number }>()
  private pinch: PinchState | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null
  private manifestUrl = ''

  private readonly onPointerDown = this.handlePointerDown.bind(this)
  private readonly onPointerMove = this.handlePointerMove.bind(this)
  private readonly onPointerUp = this.handlePointerUp.bind(this)
  private readonly onPointerCancel = this.handlePointerCancel.bind(this)
  private readonly onWheel = this.handleWheel.bind(this)
  private readonly onViewportResize = this.handleViewportResize.bind(this)
  private readonly boundTick = this.tick.bind(this)

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    if (this.shadowRoot) {
      this.shadowRoot.innerHTML = `
        <style>${SHADOW_CSS}</style>
        <div class="stage">
          <div class="bubble" part="bubble" aria-live="polite"></div>
          <div class="pet" part="pet" aria-label="Codex pet"></div>
        </div>
      `
      this.petEl = this.shadowRoot.querySelector('.pet') as HTMLElement
      this.bubbleEl = this.shadowRoot.querySelector('.bubble') as HTMLElement
    }
    this.states = buildFallbackStates(ROWS)
    this.scale = readNumber(this.getAttribute('scale'), 1)
    this.renderScale = this.scale
    this.stateName = 'idle'
  }

  static get observedAttributes(): string[] {
    return ['src', 'scale', 'position', 'auto-scale']
  }

  connectedCallback(): void {
    if (!this.hasAttribute('position')) this.setAttribute('position', 'bottom-right')
    this.petEl.addEventListener('pointerdown', this.onPointerDown)
    this.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('resize', this.onViewportResize)
    window.visualViewport?.addEventListener('resize', this.onViewportResize)
    this.applyScale()
    this.setState('idle')
    this.rafId = requestAnimationFrame(this.boundTick)
    const src = this.getAttribute('src')
    if (src) void this.load(src)
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.rafId)
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    if (this.bubbleTimer !== null) clearTimeout(this.bubbleTimer)
    this.petEl.removeEventListener('pointerdown', this.onPointerDown)
    this.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('resize', this.onViewportResize)
    window.visualViewport?.removeEventListener('resize', this.onViewportResize)
  }

  attributeChangedCallback(name: string, _oldValue: string | null, value: string | null): void {
    if (name === 'src' && value && this.isConnected) void this.load(value)
    if (name === 'scale') this.setScale(readNumber(value, this.scale))
    if (name === 'auto-scale') {
      this.applyScale()
      this.renderFrame()
      this.constrainToViewport()
    }
  }

  async load(src: string): Promise<ParsedPet | null> {
    this.manifestUrl = src
    const response = await fetch(src)
    if (!response.ok) throw new Error(`Failed to load pet manifest: ${response.status}`)
    const text = await response.text()
    const parsed = parsePetJson(text, ROWS)
    if (parsed.ok) {
      this.states = parsed.pet.states
    } else {
      // 兜底：仍按标准 9 行 atlas 播放。
      this.states = buildFallbackStates(ROWS)
    }
    const spriteUrl = resolveSpriteUrl(src, parsed.ok ? parsed.pet.spritesheetPath : 'spritesheet.webp')
    this.petEl.style.backgroundImage = `url("${spriteUrl}")`
    this.petEl.title = parsed.ok ? parsed.pet.displayName : 'Codex Pet'
    this.applyScale()
    this.renderFrame()
    return parsed.ok ? parsed.pet : null
  }

  say(message: string, options: { title?: string; state?: string; timeout?: number } = {}): void {
    const title = options.title || ''
    this.bubbleEl.innerHTML = `
      ${title ? `<strong>${escapeHtml(title)}</strong>` : ''}
      <span>${escapeHtml(message)}</span>
    `
    this.bubbleEl.classList.add('is-visible')
    if (options.state) this.setState(options.state)
    if (this.bubbleTimer !== null) clearTimeout(this.bubbleTimer)
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.classList.remove('is-visible')
      this.setState('idle')
    }, readNumber(options.timeout, BUBBLE_DEFAULT_TIMEOUT))
  }

  setState(state: string): void {
    if (this.states[state] === undefined || this.stateName === state) return
    this.stateName = state
    this.frame = state === 'idle' ? 1 : 0
    this.frameTimer = 0
    this.renderFrame()
  }

  setScale(next: number): void {
    this.scale = clamp(readNumber(next, this.scale), MIN_SCALE, MAX_SCALE)
    const rounded = String(Math.round(this.scale * 100) / 100)
    if (this.getAttribute('scale') !== rounded) this.setAttribute('scale', rounded)
    this.applyScale()
    this.renderFrame()
  }

  private handlePointerDown(event: PointerEvent): void {
    event.preventDefault()
    this.activePointers.set(event.pointerId, pointerPoint(event))
    this.petEl.setPointerCapture?.(event.pointerId)
    if (this.activePointers.size >= 2) {
      this.beginPinch()
      return
    }
    if (this.getAttribute('draggable') === 'false') return
    const rect = this.getBoundingClientRect()
    this.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      lastX: event.clientX,
    }
    this.style.right = 'auto'
    this.style.bottom = 'auto'
    this.style.left = `${rect.left}px`
    this.style.top = `${rect.top}px`
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.activePointers.has(event.pointerId)) this.activePointers.set(event.pointerId, pointerPoint(event))
    if (this.pinch && this.activePointers.size >= 2) {
      event.preventDefault()
      const [first, second] = firstTwoPointers(this.activePointers)
      const distance = pointDistance(first, second)
      if (distance > 0) {
        this.setScaleAtPoint(this.pinch.scale * (distance / this.pinch.distance), pointCenter(first, second))
      }
      return
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return
    const left = clamp(event.clientX - this.drag.offsetX, 0, window.innerWidth - this.offsetWidth)
    const top = clamp(event.clientY - this.drag.offsetY, 0, window.innerHeight - this.offsetHeight)
    this.style.left = `${left}px`
    this.style.top = `${top}px`
    const deltaX = event.clientX - this.drag.lastX
    if (Math.abs(deltaX) >= 1) this.setState(deltaX > 0 ? 'running-right' : 'running-left')
    this.drag.lastX = event.clientX
    if (this.settleTimer !== null) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.setState('idle')
    }, 180)
  }

  private handlePointerUp(event: PointerEvent): void {
    this.activePointers.delete(event.pointerId)
    if (this.pinch) {
      if (this.activePointers.size < 2) this.pinch = null
      this.petEl.releasePointerCapture?.(event.pointerId)
      return
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return
    this.drag = null
    this.petEl.releasePointerCapture?.(event.pointerId)
  }

  private handlePointerCancel(event: PointerEvent): void {
    this.activePointers.delete(event.pointerId)
    if (this.activePointers.size < 2) this.pinch = null
    if (this.drag?.pointerId === event.pointerId) this.drag = null
    this.petEl.releasePointerCapture?.(event.pointerId)
  }

  private handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    this.setScaleAtPoint(this.scale + direction * WHEEL_SCALE_STEP, pointerPoint(event))
  }

  private beginPinch(): void {
    const [first, second] = firstTwoPointers(this.activePointers)
    const distance = pointDistance(first, second)
    if (distance <= 0) return
    this.drag = null
    this.pinch = { distance, scale: this.scale }
    this.anchorToCurrentRect()
  }

  private setScaleAtPoint(scale: number, point: { x: number; y: number }): void {
    const rect = this.getBoundingClientRect()
    const ratioX = rect.width ? clamp((point.x - rect.left) / rect.width, 0, 1) : 0.5
    const ratioY = rect.height ? clamp((point.y - rect.top) / rect.height, 0, 1) : 0.5
    this.anchorToCurrentRect(rect)
    this.setScale(scale)
    const width = this.offsetWidth
    const height = this.offsetHeight
    const left = clamp(point.x - width * ratioX, 0, Math.max(0, window.innerWidth - width))
    const top = clamp(point.y - height * ratioY, 0, Math.max(0, window.innerHeight - height))
    this.style.left = `${left}px`
    this.style.top = `${top}px`
  }

  private anchorToCurrentRect(rect: DOMRect = this.getBoundingClientRect()): void {
    this.style.right = 'auto'
    this.style.bottom = 'auto'
    this.style.left = `${rect.left}px`
    this.style.top = `${rect.top}px`
  }

  private tick(timestamp: number): void {
    const elapsed = this.lastTimestamp ? timestamp - this.lastTimestamp : 0
    this.lastTimestamp = timestamp
    const anim = this.states[this.stateName] ?? this.states.idle
    this.frameTimer += elapsed
    const result = frameIndex(anim, this.frameTimer)
    if (result.finished && anim.playback === 'once') {
      // 一次性动画（waving/jumping）播放完后回到 idle。
      this.setState('idle')
    }
    if (result.frame !== this.frame) {
      this.frame = result.frame
      this.renderFrame()
    }
    this.rafId = requestAnimationFrame(this.boundTick)
  }

  private applyScale(): void {
    this.renderScale = clamp(this.scale * this.autoScaleFactor(), MIN_RENDER_SCALE, MAX_SCALE)
    const petWidth = CELL_WIDTH * this.renderScale
    const petHeight = CELL_HEIGHT * this.renderScale
    const availableWidth = Math.max(128, window.innerWidth - 24)
    const bubbleWidth = clamp(availableWidth, BUBBLE_MIN_WIDTH, BUBBLE_MAX_WIDTH)
    const edgeOffset = window.innerWidth < DESKTOP_VIEWPORT ? MOBILE_EDGE_OFFSET : DESKTOP_EDGE_OFFSET
    this.style.setProperty('--codex-pet-inline', `${edgeOffset}px`)
    this.style.setProperty('--codex-pet-block', `${edgeOffset}px`)
    this.style.setProperty('--codex-pet-stage-width', `${Math.max(bubbleWidth, petWidth)}px`)
    this.style.setProperty('--codex-pet-bubble-width', `${bubbleWidth}px`)
    this.style.width = `${Math.ceil(Math.max(bubbleWidth, petWidth))}px`
    this.style.height = `${Math.ceil(petHeight + BUBBLE_HEIGHT)}px`
    this.petEl.style.width = `${CELL_WIDTH * this.renderScale}px`
    this.petEl.style.height = `${CELL_HEIGHT * this.renderScale}px`
    this.petEl.style.backgroundSize = `${CELL_WIDTH * COLUMNS * this.renderScale}px ${CELL_HEIGHT * ROWS * this.renderScale}px`
  }

  private renderFrame(): void {
    const anim = this.states[this.stateName] ?? this.states.idle
    const x = this.frame * CELL_WIDTH * this.renderScale
    const y = anim.row * CELL_HEIGHT * this.renderScale
    this.petEl.style.backgroundPosition = `-${x}px -${y}px`
  }

  private autoScaleFactor(): number {
    if (this.getAttribute('auto-scale') === 'false') return 1
    const shortestSide = Math.min(window.innerWidth || DESKTOP_VIEWPORT, window.innerHeight || DESKTOP_VIEWPORT)
    if (shortestSide >= DESKTOP_VIEWPORT) return 1
    if (shortestSide <= MOBILE_VIEWPORT) return MIN_AUTO_SCALE_FACTOR
    const progress = (shortestSide - MOBILE_VIEWPORT) / (DESKTOP_VIEWPORT - MOBILE_VIEWPORT)
    return MIN_AUTO_SCALE_FACTOR + progress * (1 - MIN_AUTO_SCALE_FACTOR)
  }

  private handleViewportResize(): void {
    this.applyScale()
    this.renderFrame()
    this.constrainToViewport()
  }

  private constrainToViewport(): void {
    if (!this.style.left && !this.style.top) return
    const left = clamp(this.offsetLeft, 0, Math.max(0, window.innerWidth - this.offsetWidth))
    const top = clamp(this.offsetTop, 0, Math.max(0, window.innerHeight - this.offsetHeight))
    this.style.left = `${left}px`
    this.style.top = `${top}px`
  }
}

export interface MountOptions {
  pet?: string
  src?: string
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  scale?: number
  autoScale?: boolean
  draggable?: boolean
  zIndex?: number
}

export function mount(options: MountOptions = {}): CodexPetElement {
  const pet = document.createElement('codex-pet') as CodexPetElement
  // 不默认指向不存在的宠物路径（原项目内置 hachiroku，本仓库没有内置资产），
  // 调用方显式传 pet/src 后才会加载。
  const src = options.pet || options.src
  if (src) pet.setAttribute('src', src)
  pet.setAttribute('position', options.position || 'bottom-right')
  pet.setAttribute('scale', String(options.scale ?? 1))
  if (options.autoScale === false) pet.setAttribute('auto-scale', 'false')
  if (options.draggable === false) pet.setAttribute('draggable', 'false')
  if (options.zIndex) pet.style.setProperty('--codex-pet-z-index', String(options.zIndex))
  document.body.appendChild(pet)
  return pet
}

if (typeof customElements !== 'undefined' && !customElements.get('codex-pet')) {
  customElements.define('codex-pet', CodexPetElement)
}

// 经典 script 标签加载时挂到 window.CodexPet。
if (typeof window !== 'undefined') {
  const api = { mount, CodexPetElement }
  window.CodexPet = Object.assign(window.CodexPet ?? {}, api)
}

declare global {
  interface Window {
    CodexPet?: { mount: typeof mount; CodexPetElement: typeof CodexPetElement }
  }
}

export default mount
