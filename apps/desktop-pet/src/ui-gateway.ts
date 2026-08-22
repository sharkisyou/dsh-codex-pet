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

export const UI_PROTOCOL_PATH = `${PROTOCOL_PATH}/ui`

export type UiClientMessage =
  | { kind: 'state/get' }
  | { kind: 'settings/update'; patch: Record<string, unknown> }
  | { kind: 'library/reload' }
  | { kind: 'pet/get'; id: string }
  | { kind: 'activity/get' }

export type UiServerMessage =
  | { kind: 'state'; state: AppStateSnapshot }
  | { kind: 'state-sync'; settings: AppStateSnapshot['settings']; agents: string[]; activity: AppStateSnapshot['activity'] }
  | { kind: 'settings'; settings: AppStateSnapshot['settings'] }
  | { kind: 'pets'; pets: AppStateSnapshot['pets'] }
  | { kind: 'agents'; agents: string[] }
  | { kind: 'activity'; activity: AppStateSnapshot['activity'] }
  | { kind: 'pet'; id: string; pet: ParsedPet; spriteDataUrl: string; atlasRows: number }
  | { kind: 'error'; message: string }

export interface UiGatewayOptions {
  controller: AppController
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
  const { controller } = options
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
      case 'activity/get':
        send(socket, { kind: 'activity', activity: controller.activitySnapshot() } satisfies UiServerMessage)
        return
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

  // Subscribe once so all connected UI windows receive live settings/agent/
  // activity changes without each socket adding duplicate listeners.
  const unsubscribe = controller.subscribe(() => {
    if (stopped) return
    broadcast({
      kind: 'state-sync',
      settings: controller.getSettings(),
      agents: controller.agents(),
      activity: controller.activitySnapshot(),
    } satisfies UiServerMessage)
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
