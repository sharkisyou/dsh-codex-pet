/**
 * Browser-side client for the desktop pet internal UI control channel.
 *
 * The settings and pet windows connect to `ws://127.0.0.1:<port>/v1/ui`. This
 * client is intentionally small: it parses the server's state/control messages
 * and exposes a few send helpers.
 */

import { DEFAULT_PORT, PROTOCOL_VERSION } from '@yshark/pet-protocol'

import type { AppStateSnapshot, ActivitySnapshot } from './controller.js'
import type { ParsedPet } from '@yshark/pet-core'

export const UI_PATH = '/v1/ui'

export interface UiClientHandlers {
  onState?(state: AppStateSnapshot): void
  onStateSync?(payload: { settings: AppStateSnapshot['settings']; agents: string[]; activity: ActivitySnapshot }): void
  onSettings?(settings: AppStateSnapshot['settings']): void
  onPets?(pets: AppStateSnapshot['pets']): void
  onPet?(pet: { id: string; pet: ParsedPet; spriteDataUrl: string; atlasRows: number }): void
  onAgents?(agents: string[]): void
  onActivity?(activity: ActivitySnapshot): void
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
}

function defaultUiUrl(port: number): string {
  return `ws://127.0.0.1:${port}${UI_PATH}`
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
      case 'state':
        handlers.onState?.(message.state as AppStateSnapshot)
        break
      case 'state-sync':
        handlers.onStateSync?.({
          settings: message.settings,
          agents: message.agents ?? [],
          activity: message.activity,
        })
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
  }
}

export { PROTOCOL_VERSION }
