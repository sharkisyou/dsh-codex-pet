/**
 * 宠物窗拖动起点判定（"宠物面"）。
 *
 * 宠物窗是 345×356 的矩形，精灵只占中间 216×234（zoom 0.9 @dpr1.25 实机量测），
 * 而 `.pet-stage` 铺满整个视口（`grid-row: 1/-1; height: 100vh`）。拖动若挂在 stage 上，
 * 等于"整个窗口都是拖动热区"——四周大片透明边距在 DOM 里照样命中，用户看到的是
 * "拖宠物旁边的空白区，宠物也跟着动"（2026-09-10 实机复现：边距按下拖 48px，
 * 窗口跟着走 48px），且与 `cursor: grab`、右键菜单（只绑精灵元素）的命中区不一致。
 *
 * 因此起拖收窄到**宠物面**：
 * - 精灵元素 `#pet`（宠物本体）；
 * - 待机剪影 `#pet-standby`（服务端不可达时精灵 `visibility: hidden` 收不到事件，
 *   此时剪影就是用户眼里的宠物本体）。
 *
 * 判定用 `Element.contains`，所以宠物面内部后加的子元素（角标、装饰）自动算本体。
 * 拖动一旦开始，指针捕获仍挂在 stage 上（本模块只判起点，不放行后续 move/up）。
 *
 * 空白区的**点击穿透**不在这里：那是另一条线（见 `.scratch/pet-clickthrough/`）。
 * 空白区目前仍会被窗口吃掉点击，只是不再能拖动宠物。
 */

/** 宠物面：真实实现是 `Element`（contains 覆盖自身与后代）。 */
export interface PetSurface {
  contains(other: Node | null): boolean
}

/** 起拖判定与指针捕获需要的事件字段（PointerEvent 满足）。 */
export interface PetDragStartEvent {
  button: number
  pointerId: number
  target: EventTarget | null
  clientX: number
  clientY: number
  screenX: number
  screenY: number
}

/** 拖动状态机（`drag-controller`）；本模块只负责"什么时候把按下交给它"。 */
export interface PetDragStarter {
  pointerDown(event: PetDragStartEvent): void
}

/** 事件宿主：真实实现是 `.pet-stage` 元素。 */
export interface PetDragHost {
  addEventListener(type: 'pointerdown', handler: (event: PetDragStartEvent) => void): void
  setPointerCapture?(pointerId: number): void
}

/** 指针按下是否落在宠物面上（事件 target 是 EventTarget，真实元素都是 Node）。 */
export function isPetSurfaceTarget(target: EventTarget | null, surfaces: readonly PetSurface[]): boolean {
  if (target === null) return false
  return surfaces.some((surface) => surface.contains(target as Node | null))
}

/**
 * 绑定拖动起点：只有落在 `surfaces` 上的左键按下才交给 `drag`，并立刻把指针捕获到
 * 宿主上（光标甩出宠物面/窗口时事件仍然到达，拖动不断）。
 */
export function bindPetDragStart(
  host: PetDragHost,
  surfaces: readonly PetSurface[],
  drag: PetDragStarter,
): void {
  host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    if (!isPetSurfaceTarget(event.target, surfaces)) return
    drag.pointerDown(event)
    if (typeof host.setPointerCapture === 'function') {
      try {
        host.setPointerCapture(event.pointerId)
      } catch {
        // 捕获失败不阻断拖动（退化为仅窗口内跟手）。
      }
    }
  })
}
