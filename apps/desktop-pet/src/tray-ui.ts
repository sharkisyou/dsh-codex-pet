/**
 * 活动托盘的共享渲染：状态标签 + 列表项渲染。
 * 被宠物窗口（浏览器降级内嵌列表）与独立托盘窗口共用，避免两处逻辑漂移。
 */

import type { TrayItemSnapshot } from './controller.js'

/** DSH 状态 → 托盘状态标签。 */
export function trayStateLabel(state: string): string {
  switch (state) {
    case 'waiting': return '需要输入'
    case 'blocked':
    case 'failed': return '受阻'
    case 'ready': return '就绪'
    case 'running':
    case 'working': return '运行中'
    default: return '空闲'
  }
}

export interface TrayItemClickHandler {
  (agent: string, sessionId: string, reason?: string): void
}

/** 渲染托盘列表项到容器。每次调用会清空并重建。 */
export function renderTrayItems(
  container: HTMLElement,
  items: TrayItemSnapshot[],
  onOpen: TrayItemClickHandler,
): void {
  container.innerHTML = ''
  if (items.length === 0) return
  for (const item of items) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'activity-tray-item' + (item.acknowledged ? ' read' : ' unread')
    row.dataset.agent = item.agent ?? ''
    row.dataset.sessionId = item.sessionId
    row.title = item.title ?? item.sessionId

    const title = document.createElement('span')
    title.className = 'activity-tray-title'
    title.textContent = item.title || item.sessionId

    const meta = document.createElement('span')
    meta.className = 'activity-tray-meta'
    meta.textContent = `${item.agent ?? '未知来源'} · ${trayStateLabel(item.state)}`

    row.append(title, meta)
    row.addEventListener('click', () => {
      if (item.agent === null) return
      onOpen(item.agent, item.sessionId, 'tray')
    })
    container.appendChild(row)
  }
}
