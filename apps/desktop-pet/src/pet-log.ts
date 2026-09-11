/**
 * 桌宠轻量日志组件。
 *
 * 目的：Windows 原生桌宠的 UI 事件/状态机难以实时观察（无 devtools），
 * 需要事后从日志排查（如"状态动画选得不对"）。本模块把结构化日志同时输出到：
 *  - console（浏览器预览 / devtools 可见）；
 *  - Windows 侧文件（Tauri 时经 `pet_log_append` 命令追加到
 *    `%USERPROFILE%\dsh-pet.log`，WSL 侧可从 /mnt/c/Users/<user>/dsh-pet.log 读取）。
 *
 * pet server（WSL）侧日志沿用其自身 logger（写 /tmp/pet-server.log），不经过本模块。
 *
 * 去重：状态同步（`applyActivity` / `applyTray` / `setState`）每次广播都会调一次，
 * 内容常常一字不差地重复上千次——而这几条日志是**交替**出现的（同一毫秒内
 * activity→setState→tray 一轮，下一秒再来一轮），所以只压"相邻重复行"几乎没用
 * （实测真实日志只压到 1.5×）。这里改成**按键去重**：同一行（scope+message+data）
 * 在 `DEDUPE_WINDOW_MS` 内只落一次，行尾 `×N` 记为这段窗口里它代表了几次——
 * 最忙的一分钟实测可压掉 ~40 倍，同时保留"状态一直在持续"的证据。
 */

// 顶部集中开关：需要全量排查时可临时关掉无关 scope。
const SCOPES_ENABLED: Record<string, boolean> = {}

/** 同一行日志的去重窗口（ms）：窗口内只落一次，行尾累计 `×N`。 */
const DEDUPE_WINDOW_MS = 5000
/** 去重表容量上限：键里含 data，超限淘汰最早写入的键，避免无界增长。 */
const DEDUPE_MAX_KEYS = 256

let fileLogAvailable: boolean | null = null

/** 每个日志键上次落盘时刻 + 自那以来被抑制的条数（Map 顺序即写入顺序）。 */
const recentLines = new Map<string, { writtenAt: number; suppressed: number }>()

function scopeEnabled(scope: string): boolean {
  return SCOPES_ENABLED[scope] !== false
}

function safeJson(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function writeFile(line: string): void {
  if (fileLogAvailable === false) return
  try {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) return
    // 动态引入避免非 Tauri 构建打包报错；成功后记住可用性，避免重复尝试。
    void import('@tauri-apps/api/core').then(({ invoke }) => {
      void invoke('pet_log_append', { line }).catch(() => { fileLogAvailable = false })
    })
  } catch {
    fileLogAvailable = false
  }
}

/**
 * 记一次该键的出现：窗口内重复返回 null（抑制），否则返回它代表的总次数。
 * 持续重复时窗口从"上次落盘"起算，所以稳定状态表现为每 5 秒一行 `×N` 的心跳。
 */
function countOccurrence(key: string, now: number): number | null {
  const entry = recentLines.get(key)
  if (entry !== undefined && now - entry.writtenAt < DEDUPE_WINDOW_MS) {
    entry.suppressed += 1
    return null
  }
  const repeats = (entry?.suppressed ?? 0) + 1
  recentLines.delete(key)
  recentLines.set(key, { writtenAt: now, suppressed: 0 })
  if (recentLines.size > DEDUPE_MAX_KEYS) {
    const oldest = recentLines.keys().next().value
    if (oldest !== undefined && oldest !== key) recentLines.delete(oldest)
  }
  return repeats
}

/**
 * 写一条日志：`[ts] [scope] message data`。
 *
 * 与近 `DEDUPE_WINDOW_MS` 内已写过的同一行（scope/message/data 三者一致）重复时
 * 不落盘，只累计计数——所以持续不变的状态表现为"每 5 秒一行 `×N`"的心跳，
 * N 是这一行代表的重复次数（含自身）。
 */
export function petLog(scope: string, message: string, data?: unknown): void {
  if (!scopeEnabled(scope)) return
  const detail = data === undefined ? '' : ` ${safeJson(data)}`
  const now = Date.now()
  const repeats = countOccurrence(`${scope}\u0000${message}\u0000${detail}`, now)
  if (repeats === null) return
  const ts = new Date(now).toISOString()
  const suffix = repeats > 1 ? ` ×${repeats}` : ''
  const line = `[${ts}] [${scope}] ${message}${detail}${suffix}`
  // eslint-disable-next-line no-console
  console.log(line)
  writeFile(line)
}

/** 状态/动画类日志专用简写。 */
export function petStateLog(scope: string, message: string, data?: unknown): void {
  petLog(scope, message, data)
}

export function setPetLogScope(scope: string, enabled: boolean): void {
  SCOPES_ENABLED[scope] = enabled
}
