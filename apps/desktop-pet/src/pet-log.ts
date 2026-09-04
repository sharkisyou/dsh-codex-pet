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
 */

// 顶部集中开关：需要全量排查时可临时关掉无关 scope。
const SCOPES_ENABLED: Record<string, boolean> = {}

let fileLogAvailable: boolean | null = null

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

/** 写一条日志：`[ts] [scope] message data`。 */
export function petLog(scope: string, message: string, data?: unknown): void {
  if (!scopeEnabled(scope)) return
  const ts = new Date().toISOString()
  const detail = data === undefined ? '' : ` ${safeJson(data)}`
  const line = `[${ts}] [${scope}] ${message}${detail}`
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
