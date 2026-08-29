/**
 * 桌宠 UI 通用小工具（纯函数，浏览器安全）。
 *
 * 由 pet-shell 与 widget 共用，避免重复实现。
 */

/** HTML 转义（用于把用户/会话文本安全地插入 innerHTML）。 */
export function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 把数值夹在 [min, max] 之间。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
