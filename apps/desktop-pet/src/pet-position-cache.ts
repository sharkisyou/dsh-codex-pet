/**
 * 宠物窗位置的**本地兜底**缓存（localStorage）。
 *
 * 位置的权威存档在服务端（`settings.json` 的 `windowX/windowY`，由前端经 WS
 * `settings/update` 落盘），但那条链路在断线时是静默丢弃的（`ui-client` 现在会把丢弃
 * 记进日志、并在重连后补发最后一笔）。这里再存一份本地，补上两个洞：
 *
 *  - **启动时先用本地值定位**：服务端没起来时（首帧同步永远不来）也能回到上次位置；
 *  - **与服务端不一致时回推**：本地值更新（断线期间的拖动）→ 启动后回推一次，
 *    让服务端收敛到本地真相（回推本身走 WS，断线时进 ui-client 的待补发槽）。
 *
 * 纯函数 + 注入 `StorageLike`，便于 node:test 覆盖；localStorage 不可用（隐私模式、
 * 配额满）时全部退化为 no-op，不影响主流程。
 */

/** 窗口外框物理坐标。 */
export interface WindowPosition {
  x: number
  y: number
}

/** localStorage 的最小接口（`window.localStorage` 天然满足）。 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** localStorage 键名。 */
export const PET_WINDOW_POS_KEY = 'pet-window-pos'

/** 位置比较容差（物理 px）：存档取整 + 平台取整误差，1px 内视为一致。 */
export const POSITION_TOLERANCE_PX = 1

/** 读本地位置；缺失/损坏/非有限数一律返回 null。 */
export function readLocalWindowPos(storage: StorageLike | null): WindowPosition | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(PET_WINDOW_POS_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const { x, y } = parsed as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || typeof y !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x: Math.round(x), y: Math.round(y) }
  } catch {
    return null
  }
}

/** 写本地位置（取整后存）；写入失败静默（本地兜底不是主路径）。 */
export function writeLocalWindowPos(storage: StorageLike | null, pos: WindowPosition): void {
  if (storage === null) return
  try {
    storage.setItem(
      PET_WINDOW_POS_KEY,
      JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }),
    )
  } catch {
    // 隐私模式 / 配额满：忽略
  }
}

/**
 * 启动恢复用哪个位置：**本地优先**——断线期间本地仍会更新，服务端可能停在旧值；
 * 没有本地值（首次运行）才退回服务端设置。两者都没有时返回 null（保持窗口默认位置）。
 */
export function preferredRestorePosition(
  local: WindowPosition | null,
  server: WindowPosition | null,
): WindowPosition | null {
  return local ?? server
}

/** 两个位置是否"实质不同"：容差内视为相同；只有一侧为 null 时算不同，都为 null 算相同。 */
export function positionsDiffer(
  a: WindowPosition | null,
  b: WindowPosition | null,
  tolerance = POSITION_TOLERANCE_PX,
): boolean {
  if (a === null || b === null) return (a === null) !== (b === null)
  return Math.abs(a.x - b.x) > tolerance || Math.abs(a.y - b.y) > tolerance
}
