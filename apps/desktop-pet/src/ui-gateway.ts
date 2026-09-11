/**
 * Internal UI control channel for the desktop pet windows.
 *
 * This is deliberately separate from the public pet wire protocol: it is the
 * desktop app's own control plane used by the pet window and settings window.
 * It runs on the same WebSocket port under `/v1/ui` and is implemented as a
 * delegate path on the server's shared HTTP upgrade handler.
 */

import { PROTOCOL_PATH } from '@yshark/pet-protocol'

import type { ParsedPet } from '@yshark/pet-core'

import type { AppController, AppStateSnapshot } from './controller.js'
import type { WsLike } from './server.js'
import type { Market } from './market.js'
import type { MarketPet } from './market-types.js'
import { clampDarkTheme, clampLanguage, clampLightTheme, clampThemeMode } from './settings-store.js'

export const UI_PROTOCOL_PATH = `${PROTOCOL_PATH}/ui`

export type UiClientMessage =
  | { kind: 'state/get' }
  | { kind: 'settings/update'; patch: Record<string, unknown> }
  | { kind: 'library/reload' }
  | { kind: 'pet/get'; id: string }
  | { kind: 'activity/get' }
  | { kind: 'activities/get' }
  | { kind: 'activity/ack'; agent: string; sessionId: string }
  | { kind: 'activity/open'; agent: string; sessionId: string; reason?: string }
  | { kind: 'tray/ack'; agent: string; sessionId: string }
  | { kind: 'tray/read'; agent: string; sessionId: string }
  | { kind: 'session/open'; agent: string; sessionId: string; reason?: string }
  | { kind: 'tray/open'; agent: string; sessionId: string; reason?: string }
  | { kind: 'tray/click'; agent: string; sessionId: string; reason?: string }
  | { kind: 'market/list'; query?: string; petKind?: string; page?: number; pageSize?: number }
  | { kind: 'market/install'; pet: MarketPet }
  | { kind: 'market/uninstall'; slug: string }
  | { kind: 'market/thumb'; pet: MarketPet }
  | { kind: 'market/pet'; pet: MarketPet }
  | { kind: 'pet/thumb'; id: string }

export type UiServerMessage =
  | { kind: 'state'; state: AppStateSnapshot }
  | { kind: 'state-sync'; settings: AppStateSnapshot['settings']; agents: string[]; activity: AppStateSnapshot['activity']; activities: AppStateSnapshot['activities']; tray: AppStateSnapshot['tray']; allActivities: AppStateSnapshot['allActivities'] }
  | { kind: 'settings'; settings: AppStateSnapshot['settings'] }
  | { kind: 'pets'; pets: AppStateSnapshot['pets'] }
  | { kind: 'agents'; agents: string[] }
  | { kind: 'activity'; activity: AppStateSnapshot['activity'] }
  | { kind: 'activities'; activities: AppStateSnapshot['activities'] }
  | { kind: 'tray'; tray: AppStateSnapshot['tray'] }
  | { kind: 'allActivities'; allActivities: AppStateSnapshot['allActivities'] }
  | { kind: 'pet'; id: string; pet: ParsedPet; spriteDataUrl: string; atlasRows: number }
  | { kind: 'pet-thumb'; id: string; dataUrl: string | null }
  | { kind: 'market/list'; pets: MarketPet[]; total: number; page: number; pageSize: number; kinds: string[] }
  | { kind: 'market/list-error'; message: string }
  | { kind: 'market/installed'; pet: { id: string; displayName: string; sourceDir: string } }
  | { kind: 'market/uninstalled'; slug: string }
  | { kind: 'market/thumb'; slug: string; dataUrl: string }
  | { kind: 'market/thumb-error'; slug: string }
  | { kind: 'market/pet'; slug: string; pet: ParsedPet | null; spriteDataUrl: string | null }
  | { kind: 'error'; message: string }

export interface UiGatewayOptions {
  controller: AppController
  /** 在线宠物市场访问器（可选；未提供时 market/* 消息返回错误）。 */
  market?: Market
}

export interface UiGateway {
  readonly path: string
  readonly sockets: ReadonlySet<WsLike>
  handleConnection(socket: WsLike): void
  broadcast(message: unknown): number
  stop(): void
}

function parseJson(data: unknown): unknown {
  if (data !== null && typeof data === 'object' && !(data instanceof ArrayBuffer) && 'data' in data) {
    return parseJson((data as { data: unknown }).data)
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    try {
      return JSON.parse(data.toString('utf8'))
    } catch {
      return null
    }
  }
  if (data instanceof ArrayBuffer) {
    try {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(data)))
    } catch {
      return null
    }
  }
  if (data instanceof Uint8Array) {
    try {
      return JSON.parse(new TextDecoder().decode(data))
    } catch {
      return null
    }
  }
  return data
}

function send(socket: WsLike, message: unknown): boolean {
  if (!socket || typeof socket.send !== 'function') return false
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

export function createUiGateway(options: UiGatewayOptions): UiGateway {
  const { controller, market } = options
  const sockets = new Set<WsLike>()
  let stopped = false

  async function sendState(socket: WsLike): Promise<void> {
    try {
      const state = await controller.stateSnapshot()
      send(socket, { kind: 'state', state } satisfies UiServerMessage)
    } catch (error) {
      send(socket, { kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  function broadcast(message: unknown): number {
    let count = 0
    for (const socket of sockets) {
      if (send(socket, message)) count++
    }
    return count
  }

  async function handleMessage(data: unknown, socket: WsLike): Promise<void> {
    const value = parseJson(data)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const message = value as Partial<UiClientMessage> & Record<string, unknown>

    switch (message.kind) {
      case 'state/get':
        await sendState(socket)
        return
      case 'settings/update': {
        const patch = message.patch !== null && typeof message.patch === 'object' ? message.patch as Record<string, unknown> : {}
        const result = await controller.updateSettings({
          ...(typeof patch.selectedPetId === 'string' || patch.selectedPetId === null ? { selectedPetId: patch.selectedPetId } : {}),
          ...(typeof patch.zoom === 'number' ? { zoom: patch.zoom } : {}),
          ...(typeof patch.awake === 'boolean' ? { awake: patch.awake } : {}),
          ...(typeof patch.themeMode === 'string' ? { themeMode: clampThemeMode(patch.themeMode) } : {}),
          ...(typeof patch.darkTheme === 'string' ? { darkTheme: clampDarkTheme(patch.darkTheme) } : {}),
          ...(typeof patch.lightTheme === 'string' ? { lightTheme: clampLightTheme(patch.lightTheme) } : {}),
          ...(typeof patch.language === 'string' ? { language: clampLanguage(patch.language) } : {}),
          ...(typeof patch.windowX === 'number' && Number.isFinite(patch.windowX) ? { windowX: Math.round(patch.windowX) } : {}),
          ...(typeof patch.windowY === 'number' && Number.isFinite(patch.windowY) ? { windowY: Math.round(patch.windowY) } : {}),
          ...(typeof patch.x === 'number' && Number.isFinite(patch.x) ? { windowX: Math.round(patch.x) } : {}),
          ...(typeof patch.y === 'number' && Number.isFinite(patch.y) ? { windowY: Math.round(patch.y) } : {}),
        })
        if (!result.ok) {
          send(socket, { kind: 'error', message: result.error })
          return
        }
        broadcast({ kind: 'settings', settings: result.settings } satisfies UiServerMessage)
        return
      }
      case 'library/reload': {
        const pets = await controller.reloadLibrary()
        broadcast({ kind: 'pets', pets } satisfies UiServerMessage)
        await sendState(socket)
        return
      }
      case 'market/list': {
        if (!market) {
          send(socket, { kind: 'error', message: '在线宠物市场不可用' })
          return
        }
        try {
          const query = typeof message.query === 'string' ? message.query : undefined
          const kind = typeof message.petKind === 'string' ? message.petKind : undefined
          const page = typeof message.page === 'number' ? message.page : 1
          const pageSize = typeof message.pageSize === 'number' ? message.pageSize : undefined
          const result = await market.listPets({ query, kind, page, pageSize })
          const kinds = await market.listKinds()
          send(socket, {
            kind: 'market/list',
            pets: result.pets,
            total: result.total,
            page,
            pageSize: result.pets.length,
            kinds,
          } satisfies UiServerMessage)
        } catch (error) {
          // 结构化错误：前端必须在失败后复位加载态（否则「下一页/搜索」永久无响应）。
          send(socket, {
            kind: 'market/list-error',
            message: error instanceof Error ? error.message : String(error),
          } satisfies UiServerMessage)
        }
        return
      }
      case 'market/install': {
        if (!market) {
          send(socket, { kind: 'error', message: '在线宠物市场不可用' })
          return
        }
        const pet = message.pet
        if (!pet || typeof pet.slug !== 'string' || pet.slug === '') {
          send(socket, { kind: 'error', message: '缺少市场宠物信息' })
          return
        }
        const result = await market.installPet(pet)
        if (!result.ok) {
          send(socket, { kind: 'error', message: `安装失败: ${result.error}` })
          return
        }
        send(socket, { kind: 'market/installed', pet: result.value } satisfies UiServerMessage)
        // 安装成功后刷新本地宠物库并广播，让本地列表立即出现新宠物。
        const pets = await controller.reloadLibrary()
        broadcast({ kind: 'pets', pets } satisfies UiServerMessage)
        await sendState(socket)
        return
      }
      case 'market/uninstall': {
        if (!market) {
          send(socket, { kind: 'error', message: '在线宠物市场不可用' })
          return
        }
        const slug = typeof message.slug === 'string' ? message.slug : ''
        if (slug === '') {
          send(socket, { kind: 'error', message: '缺少宠物 slug' })
          return
        }
        const result = await market.uninstallPet(slug)
        if (!result.ok) {
          send(socket, { kind: 'error', message: `卸载失败: ${result.error}` })
          return
        }
        send(socket, { kind: 'market/uninstalled', slug } satisfies UiServerMessage)
        // 卸载后同样刷新并广播本地宠物库。
        const petsAfter = await controller.reloadLibrary()
        broadcast({ kind: 'pets', pets: petsAfter } satisfies UiServerMessage)
        await sendState(socket)
        return
      }
      case 'market/thumb': {
        if (!market) {
          send(socket, { kind: 'error', message: '在线宠物市场不可用' })
          return
        }
        const pet = message.pet
        if (!pet || typeof pet.slug !== 'string' || pet.slug === '') {
          send(socket, { kind: 'error', message: '缺少市场宠物信息' })
          return
        }
        const dataUrl = await market.getThumbnail(pet)
        if (dataUrl === null) {
          // 缩略图只是增强项：失败走结构化事件（前端静默退避重试），
          // 不冒泡成全局错误行「缩略图生成失败」。
          send(socket, { kind: 'market/thumb-error', slug: pet.slug } satisfies UiServerMessage)
          return
        }
        send(socket, { kind: 'market/thumb', slug: pet.slug, dataUrl } satisfies UiServerMessage)
        return
      }
      case 'market/pet': {
        if (!market) {
          send(socket, { kind: 'error', message: '在线宠物市场不可用' })
          return
        }
        const pet = message.pet
        if (!pet || typeof pet.slug !== 'string' || pet.slug === '') {
          send(socket, { kind: 'error', message: '缺少市场宠物信息' })
          return
        }
        // 已安装的宠物优先从本地读取（~/.codex/pets/<slug>/）：无需再请求 CDN，
        // 加载更快且离线可用。未安装才走 CDN 下载。
        const local = await controller.loadPet(pet.slug)
        if (local !== null) {
          send(socket, {
            kind: 'market/pet',
            slug: pet.slug,
            pet: local.pet,
            spriteDataUrl: local.spriteDataUrl,
          } satisfies UiServerMessage)
          return
        }
        const detail = await market.getPetDetail(pet)
        send(socket, {
          kind: 'market/pet',
          slug: pet.slug,
          pet: detail.pet,
          spriteDataUrl: detail.spriteDataUrl,
        } satisfies UiServerMessage)
        return
      }
      case 'pet/get': {
        const id = typeof message.id === 'string' ? message.id : ''
        if (id === '') {
          send(socket, { kind: 'error', message: '缺少宠物 id' })
          return
        }
        const loaded = await controller.loadPet(id)
        if (loaded === null) {
          send(socket, { kind: 'error', message: `无法加载宠物: ${id}` })
          return
        }
        send(socket, {
          kind: 'pet',
          id,
          pet: loaded.pet,
          spriteDataUrl: loaded.spriteDataUrl,
          atlasRows: loaded.atlasRows,
        } satisfies UiServerMessage)
        return
      }
      case 'pet/thumb': {
        const id = typeof message.id === 'string' ? message.id : ''
        if (id === '') {
          send(socket, { kind: 'error', message: '缺少宠物 id' })
          return
        }
        // 卡片缩略图（96×104 webp，~9KB）：失败返回 null，前端保留占位样式。
        const dataUrl = await controller.petThumbnail(id)
        send(socket, { kind: 'pet-thumb', id, dataUrl } satisfies UiServerMessage)
        return
      }
      case 'activity/get':
        send(socket, { kind: 'activity', activity: controller.activitySnapshot() } satisfies UiServerMessage)
        return
      case 'activities/get': {
        const activities = controller.activityList()
        const tray = controller.trayActivities()
        send(socket, { kind: 'activities', activities } satisfies UiServerMessage)
        send(socket, { kind: 'tray', tray } satisfies UiServerMessage)
        send(socket, { kind: 'allActivities', allActivities: controller.allActivities() } satisfies UiServerMessage)
        return
      }
      case 'activity/ack':
      case 'tray/ack':
      case 'tray/read': {
        const agent = typeof message.agent === 'string' ? message.agent : ''
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : ''
        if (agent === '' || sessionId === '') {
          send(socket, { kind: 'error', message: '缺少来源工具或会话 id' })
          return
        }
        controller.markActivityRead(agent, sessionId)
        return
      }
      case 'session/open':
      case 'tray/open':
      case 'activity/open':
      case 'tray/click': {
        const agent = typeof message.agent === 'string' ? message.agent : ''
        const sessionId = typeof message.sessionId === 'string' ? message.sessionId : ''
        const reason = typeof message.reason === 'string' && message.reason !== '' ? message.reason : 'tray'
        if (agent === '' || sessionId === '') {
          send(socket, { kind: 'error', message: '缺少来源工具或会话 id' })
          return
        }
        controller.handleTrayClick(agent, sessionId, reason)
        return
      }
      default:
        // Unknown internal messages are ignored.
        return
    }
  }

  function handleConnection(socket: WsLike): void {
    if (stopped || socket === null || typeof socket !== 'object') return
    if (sockets.has(socket)) return
    sockets.add(socket)

    if (typeof socket.on === 'function') {
      socket.on('message', (data: unknown) => { void handleMessage(data, socket) })
      socket.on('close', () => { sockets.delete(socket) })
      socket.on('error', () => { sockets.delete(socket) })
    } else if (typeof (socket as any).addEventListener === 'function') {
      const target = socket as any
      target.addEventListener?.('message', (event: any) => { void handleMessage(event?.data ?? event, socket) })
      target.addEventListener?.('close', () => { sockets.delete(socket) })
    } else if ('onmessage' in socket || 'onclose' in socket) {
      const target = socket as any
      target.onmessage = (event: any) => { void handleMessage(event?.data ?? event, socket) }
      target.onclose = () => { sockets.delete(socket) }
    }

    void sendState(socket)
  }

  /**
   * 上一次已广播的 state-sync 内容指纹（B：源头去重）。
   *
   * DSH 会话活跃时 controller 会高频通知，而绝大多数通知产出的快照**逐字节相同**
   * （实测最忙一分钟 511 次/窗口）。内容没变就直接不发：省掉 pet server 的序列化
   * 与发送，也省掉所有窗口的解析 + DOM 更新 + 日志（前端那层去重只是末端兜底）。
   */
  let lastStateSyncKey: string | null = null

  // Subscribe once so all connected UI windows receive live settings/agent/
  // activity changes without each socket adding duplicate listeners.
  const unsubscribe = controller.subscribe(() => {
    if (stopped) return
    const activities = controller.activityList()
    const tray = controller.trayActivities()
    const payload = {
      kind: 'state-sync',
      settings: controller.getSettings(),
      agents: controller.agents(),
      activity: controller.activitySnapshot(),
      activities,
      tray,
      allActivities: controller.allActivities(),
    } satisfies UiServerMessage
    const key = JSON.stringify(payload)
    if (key === lastStateSyncKey) return
    lastStateSyncKey = key
    broadcast(payload)
  })

  function stop(): void {
    if (stopped) return
    stopped = true
    unsubscribe()
    for (const socket of sockets) {
      try {
        socket.close(1001, 'desktop pet shutting down')
      } catch {
        // ignore
      }
    }
    sockets.clear()
  }

  return {
    path: UI_PROTOCOL_PATH,
    sockets,
    handleConnection,
    broadcast,
    stop,
  }
}
