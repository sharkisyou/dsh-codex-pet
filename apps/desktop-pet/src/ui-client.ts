/**
 * Browser-side client for the desktop pet internal UI control channel.
 *
 * The settings and pet windows connect to `ws://127.0.0.1:<port>/v1/ui`. This
 * client is intentionally small: it parses the server's state/control messages
 * and exposes a few send helpers.
 */

import { DEFAULT_PORT, PROTOCOL_VERSION } from '@yshark/pet-protocol'

import type { AppStateSnapshot, ActivitySnapshot, TrayItemSnapshot } from './controller.js'
import type { ParsedPet } from '@yshark/pet-core'
import type { MarketPet } from './market-types.js'

export const UI_PATH = '/v1/ui'

export interface UiClientHandlers {
  onState?(state: AppStateSnapshot): void
  onStateSync?(payload: { settings: AppStateSnapshot['settings']; agents: string[]; activity: ActivitySnapshot; activities?: TrayItemSnapshot[]; tray?: TrayItemSnapshot[]; allActivities?: TrayItemSnapshot[] }): void
  onSettings?(settings: AppStateSnapshot['settings']): void
  onPets?(pets: AppStateSnapshot['pets']): void
  onPet?(pet: { id: string; pet: ParsedPet; spriteDataUrl: string; atlasRows: number }): void
  onAgents?(agents: string[]): void
  onActivity?(activity: ActivitySnapshot): void
  onActivities?(activities: TrayItemSnapshot[]): void
  onTray?(tray: TrayItemSnapshot[]): void
  onAllActivities?(activities: TrayItemSnapshot[]): void
  onMarketList?(payload: { pets: MarketPet[]; total: number; page: number; pageSize: number; kinds: string[] }): void
  onMarketListError?(message: string): void
  onMarketInstalled?(info: { id: string; displayName: string; sourceDir: string }): void
  onMarketUninstalled?(payload: { slug: string }): void
  onMarketThumb?(payload: { slug: string; dataUrl: string }): void
  onMarketThumbError?(payload: { slug: string }): void
  onMarketPet?(payload: { slug: string; pet: ParsedPet | null; spriteDataUrl: string | null }): void
  onError?(message: string): void
  onStatus?(connected: boolean): void
}

export interface UiClientOptions {
  url?: string
  port?: number
  handlers?: UiClientHandlers
  reconnect?: boolean
}

export interface UiClient {
  readonly url: string
  isConnected(): boolean
  connect(): void
  close(): void
  send(message: unknown): boolean
  requestState(): void
  updateSettings(patch: Record<string, unknown>): void
  reloadLibrary(): void
  requestPet(id: string): void
  requestActivities(): void
  markActivityRead(agent: string, sessionId: string): void
  markRead(agent: string, sessionId: string): void
  openSession(agent: string, sessionId: string, reason?: string): void
  openActivity(agent: string, sessionId: string, reason?: string): void
  openTrayItem(agent: string, sessionId: string, reason?: string): void
  trayClick(agent: string, sessionId: string, reason?: string): void
  /** 请求在线宠物市场列表（petdex，支持分页）。 */
  requestMarketList(options?: { query?: string; kind?: string; page?: number; pageSize?: number }): void
  /** 从在线市场安装一只宠物。 */
  installMarketPet(pet: MarketPet): void
  /** 卸载本地宠物（删除 ~/.codex/pets/<slug>/）。 */
  uninstallMarketPet(slug: string): void
  /** 请求某只市场宠物的缩略图（服务端生成 data URL）。 */
  requestMarketThumb(pet: MarketPet): void
  /** 请求某只市场宠物的详情（解析后的 pet + 全 sprite data URL，用于大图预览）。 */
  requestMarketPet(pet: MarketPet): void
}

function defaultUiUrl(port: number): string {
  // 桌面应用（Tauri）里页面从 localhost/tauri:// 加载 → 连 127.0.0.1；
  // 浏览器预览通过局域网 IP 打开时，让 WS 连同一台机器的同一主机名，
  // 这样预览页能直接连上本地 pet 服务（省去手动 ?uiurl= 参数）。
  const pageHost = typeof location !== 'undefined' ? location.hostname : ''
  const host =
    pageHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1'
      ? pageHost
      : '127.0.0.1'
  return `ws://${host}:${port}${UI_PATH}`
}

export function createUiClient(options: UiClientOptions = {}): UiClient {
  const handlers = options.handlers ?? {}
  const queryPort = Number.parseInt(
    new URLSearchParams(window.location.search).get('uiport') ?? '',
    10,
  )
  const port = options.port ?? (Number.isFinite(queryPort) && queryPort > 0 ? queryPort : DEFAULT_PORT)
  const requestedUrl = options.url ?? new URLSearchParams(window.location.search).get('uiurl') ?? defaultUiUrl(port)
  let socket: WebSocket | null = null
  let connected = false
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  const reconnectEnabled = options.reconnect !== false

  function emitStatus(): void {
    handlers.onStatus?.(connected)
  }

  function connect(): void {
    if (closed) return
    if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
    try {
      socket = new WebSocket(requestedUrl)
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error.message : String(error))
      scheduleReconnect()
      return
    }
    const current = socket
    current.onopen = () => {
      if (current !== socket) return
      connected = true
      reconnectAttempt = 0
      emitStatus()
      // Ask for the full snapshot on connect; the gateway also sends one
      // automatically, but this makes reconnects deterministic.
      send({ kind: 'state/get' })
    }
    current.onmessage = (event) => {
      if (current !== socket) return
      try {
        const message = JSON.parse(String(event.data)) as Record<string, any>
        handleMessage(message)
      } catch {
        // ignore malformed internal messages
      }
    }
    current.onerror = () => {
      // onclose is the authority for reconnect.
    }
    current.onclose = () => {
      if (current !== socket) return
      socket = null
      connected = false
      emitStatus()
      scheduleReconnect()
    }
  }

  function scheduleReconnect(): void {
    if (closed || !reconnectEnabled) return
    if (reconnectTimer !== null) return
    const delay = Math.min(5000, 500 * 2 ** reconnectAttempt)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function handleMessage(message: Record<string, any>): void {
    switch (message.kind) {
      case 'state': {
        const state = message.state as AppStateSnapshot
        handlers.onState?.(state)
        handlers.onActivities?.(state.activities ?? [])
        handlers.onTray?.(state.tray ?? state.activities ?? [])
        break
      }
      case 'state-sync':
        handlers.onStateSync?.({
          settings: message.settings,
          agents: message.agents ?? [],
          activity: message.activity,
          activities: message.activities ?? [],
          tray: message.tray ?? message.activities ?? [],
          allActivities: message.allActivities ?? message.activities ?? [],
        })
        handlers.onActivities?.(message.activities ?? [])
        handlers.onTray?.(message.tray ?? message.activities ?? [])
        break
      case 'settings':
        handlers.onSettings?.(message.settings)
        break
      case 'pets':
        handlers.onPets?.(message.pets ?? [])
        break
      case 'pet':
        handlers.onPet?.({
          id: message.id,
          pet: message.pet,
          spriteDataUrl: message.spriteDataUrl,
          atlasRows: message.atlasRows,
        })
        break
      case 'agents':
        handlers.onAgents?.(message.agents ?? [])
        break
      case 'activity':
        handlers.onActivity?.(message.activity)
        break
      case 'activities':
        handlers.onActivities?.(message.activities ?? [])
        break
      case 'tray':
        handlers.onTray?.(message.tray ?? [])
        break
      case 'allActivities':
        handlers.onAllActivities?.(message.allActivities ?? [])
        break
      case 'market/list':
        handlers.onMarketList?.({
          pets: message.pets ?? [],
          total: typeof message.total === 'number' ? message.total : (message.pets ?? []).length,
          page: typeof message.page === 'number' ? message.page : 1,
          pageSize: typeof message.pageSize === 'number' ? message.pageSize : (message.pets ?? []).length,
          kinds: Array.isArray(message.kinds) ? message.kinds : [],
        })
        break
      case 'market/list-error':
        handlers.onMarketListError?.(message.message ?? '未知错误')
        break
      case 'market/installed':
        handlers.onMarketInstalled?.(message.pet)
        break
      case 'market/uninstalled':
        handlers.onMarketUninstalled?.({ slug: message.slug })
        break
      case 'market/thumb':
        handlers.onMarketThumb?.({ slug: message.slug, dataUrl: message.dataUrl })
        break
      case 'market/thumb-error':
        handlers.onMarketThumbError?.({ slug: message.slug })
        break
      case 'market/pet':
        handlers.onMarketPet?.({ slug: message.slug, pet: message.pet ?? null, spriteDataUrl: message.spriteDataUrl ?? null })
        break
      case 'error':
        handlers.onError?.(message.message ?? '未知错误')
        break
      default:
        break
    }
  }

  function send(message: unknown): boolean {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false
    try {
      socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  function requestState(): void {
    send({ kind: 'state/get' })
  }

  function updateSettings(patch: Record<string, unknown>): void {
    send({ kind: 'settings/update', patch })
  }

  function reloadLibrary(): void {
    send({ kind: 'library/reload' })
  }

  function requestPet(id: string): void {
    send({ kind: 'pet/get', id })
  }

  function requestActivities(): void {
    send({ kind: 'activities/get' })
  }

  function markActivityRead(agent: string, sessionId: string): void {
    send({ kind: 'activity/ack', agent, sessionId })
  }

  function markRead(agent: string, sessionId: string): void {
    markActivityRead(agent, sessionId)
  }

  function openSession(agent: string, sessionId: string, reason?: string): void {
    send({ kind: 'session/open', agent, sessionId, ...(reason ? { reason } : {}) })
  }

  function openActivity(agent: string, sessionId: string, reason?: string): void {
    send({ kind: 'activity/open', agent, sessionId, ...(reason ? { reason } : {}) })
  }

  function openTrayItem(agent: string, sessionId: string, reason?: string): void {
    send({ kind: 'tray/open', agent, sessionId, ...(reason ? { reason } : {}) })
  }

  function trayClick(agent: string, sessionId: string, reason?: string): void {
    send({ kind: 'tray/click', agent, sessionId, ...(reason ? { reason } : {}) })
  }

  function requestMarketList(options: { query?: string; kind?: string; page?: number; pageSize?: number } = {}): void {
    send({
      kind: 'market/list',
      ...(options.query ? { query: options.query } : {}),
      ...(options.kind ? { petKind: options.kind } : {}),
      ...(typeof options.page === 'number' ? { page: options.page } : {}),
      ...(typeof options.pageSize === 'number' ? { pageSize: options.pageSize } : {}),
    })
  }

  function installMarketPet(pet: MarketPet): void {
    send({ kind: 'market/install', pet })
  }

  function uninstallMarketPet(slug: string): void {
    send({ kind: 'market/uninstall', slug })
  }

  function requestMarketThumb(pet: MarketPet): void {
    send({ kind: 'market/thumb', pet })
  }

  function requestMarketPet(pet: MarketPet): void {
    send({ kind: 'market/pet', pet })
  }

  function close(): void {
    closed = true
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    reconnectTimer = null
    const current = socket
    socket = null
    if (current !== null) {
      current.onclose = null
      try {
        current.close()
      } catch {
        // ignore
      }
    }
    connected = false
    emitStatus()
  }

  connect()

  return {
    url: requestedUrl,
    isConnected: () => connected,
    connect,
    close,
    send,
    requestState,
    updateSettings,
    reloadLibrary,
    requestPet,
    requestActivities,
    markActivityRead,
    markRead,
    openSession,
    openActivity,
    openTrayItem,
    trayClick,
    requestMarketList,
    installMarketPet,
    uninstallMarketPet,
    requestMarketThumb,
    requestMarketPet,
  }
}

export { PROTOCOL_VERSION }
