/**
 * Desktop Pet WebSocket server.
 *
 * The desktop app is the smart side of the two-part system: it listens on a
 * versioned WebSocket path, accepts bridge/client connections, validates wire
 * events, feeds them into the shared pet-core session store, and exposes a
 * small read model used by the Canvas renderer.
 *
 * This module is intentionally dependency-injectable so the same server logic
 * can be tested with a fake WebSocket server in Node without opening a port.
 */

import { createRequire } from 'node:module'

import {
  DEFAULT_PORT,
  DEFAULT_WS_URL,
  PROTOCOL_PATH,
  PROTOCOL_VERSION,
  validatePetEvent,
  type PetEvent,
} from '@yshark/pet-protocol'
import {
  createPetSessionStore,
  type PetSessionTracker,
  type SessionStoreActivity,
  type SessionStoreEvent,
} from '@yshark/pet-core'

const require = createRequire(import.meta.url)

export interface WsLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  on?(event: string, listener: (...args: any[]) => void): void
  removeListener?(event: string, listener: (...args: any[]) => void): void
  readyState?: number
}

export interface WebSocketServerLike {
  on(event: 'connection', listener: (socket: WsLike, req?: unknown) => void): void
  on(event: 'listening', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
  close(callback?: () => void): void
  address(): { port: number } | { address: string; port: number } | null
  clients?: Set<WsLike>
}

export interface PetServerEvents {
  /** Called after any valid wire event has been applied to the session store. */
  onEvent?(event: PetEvent, server: PetServer): void
  /** Called when a client connection is accepted and its handshake succeeds. */
  onConnect?(agent: string, socket: WsLike): void
  /** Called when a client connection closes. */
  onDisconnect?(agent: string | null, socket: WsLike): void
}

export interface PetServerOptions extends PetServerEvents {
  host?: string
  port?: number
  path?: string
  store?: PetSessionTracker
  /** Extra paths handled by delegates on the same HTTP/WebSocket server (real mode only). */
  delegates?: Record<string, (socket: WsLike, req?: unknown) => void>
  WebSocketServerImpl?: new (options: Record<string, unknown>) => WebSocketServerLike
  WebSocketServer?: new (options: Record<string, unknown>) => WebSocketServerLike
  logger?: {
    log?(...args: unknown[]): void
    info?(...args: unknown[]): void
    warn?(...args: unknown[]): void
    error?(...args: unknown[]): void
  } | null
}

export interface PetServer {
  readonly host: string
  readonly port: number
  readonly path: string
  readonly store: PetSessionTracker
  readonly connections: ReadonlyMap<string, ReadonlySet<WsLike>>
  readonly clients: ReadonlySet<WsLike>
  readonly agents: readonly string[]
  start(): Promise<PetServer>
  listen(): Promise<PetServer>
  stop(): Promise<void>
  close(): Promise<void>
  isListening(): boolean
  isOnline(): boolean
  isConnected(): boolean
  hasClients(): boolean
  address(): { port: number } | null
  getPort(): number | null
  readonly actualPort: number | null
  url(): string
  readonly wsUrl: string
  getUrl(): string
  handleConnection(socket: WsLike): void
  handleClose(socket: WsLike): void
  handleMessage(data: unknown, socket: WsLike): void
  handleEvent(data: unknown, socket: WsLike): void
  handleIncoming(data: unknown, socket: WsLike): void
  activeActivities(): SessionStoreActivity[]
  activityList(): SessionStoreActivity[]
  trayActivities(): SessionStoreActivity[]
  activities(): SessionStoreActivity[]
  tray(): SessionStoreActivity[]
  allActivities(): SessionStoreActivity[]
  markAcknowledged(agent: string, sessionId: string): boolean
  markRead(agent: string, sessionId: string): boolean
  exportSnapshot(agent: string): unknown[]
  snapshotFor(agent: string): unknown[]
  currentActivity(): SessionStoreActivity | null
  currentDisplayState(): string
  currentState(): string
  displayState(): string
  connectedAgents(): string[]
  openSession(agent: string, sessionId: string, reason?: string): boolean
  send(socket: WsLike, event: unknown): boolean
  broadcast(event: unknown): number
  subscribe(listener: (activity: SessionStoreActivity | null) => void): () => void
  onChange(listener: () => void): () => void
}

function parseData(data: unknown): unknown {
  if (data !== null && typeof data === 'object' && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array) && 'data' in data) {
    return parseData((data as { data: unknown }).data)
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

export function createPetServer(options: PetServerOptions = {}): PetServer {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? DEFAULT_PORT
  const path = options.path ?? PROTOCOL_PATH
  const logger = options.logger ?? console
  const store = options.store ?? createPetSessionStore({ stateStyle: 'protocol' })

  const connections = new Map<string, Set<WsLike>>()
  const sockets = new Set<WsLike>()
  const listeners = new Set<() => void>()
  let server: WebSocketServerLike | null = null
  let httpServer: { close(callback?: () => void): void; address(): unknown; destroy?(): void } | null = null
  let listening = false
  let starting: Promise<PetServer> | null = null

  function usesInjectedServer(): boolean {
    return options.WebSocketServerImpl !== undefined || options.WebSocketServer !== undefined
  }

  function log(...args: unknown[]): void {
    if (logger && typeof logger.info === 'function') logger.info('[desktop-pet]', ...args)
  }

  // 活动签名变化日志：每次 store 变化后打印一次"优先级排序后的活动清单"，
  // 供排查宠物显示状态/动画选错（如 ready 何时成为当前活动）。
  let lastActivitySignature: string | null = null
  function logActivityChange(): void {
    try {
      const acts = store.activities()
      const sig = acts.length === 0
        ? '(none)'
        : acts.map((a) => `${a.agent ?? '?'}:${a.sessionId}=${a.state}`).join(' | ')
      if (sig === lastActivitySignature) return
      lastActivitySignature = sig
      log('activity', sig)
    } catch {
      // ignore
    }
  }

  function notify(): void {
    logActivityChange()
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // listener errors must not break the server
      }
    }
  }

  function subscribe(listener: (activity: SessionStoreActivity | null) => void): () => void {
    const wrapped = (): void => { listener(currentActivity()) }
    listeners.add(wrapped)
    return () => { listeners.delete(wrapped) }
  }

  function onChange(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function registerAgent(agent: string, socket: WsLike): void {
    let set = connections.get(agent)
    if (set === undefined) {
      set = new Set()
      connections.set(agent, set)
    }
    set.add(socket)
  }

  function send(socket: WsLike, event: unknown): boolean {
    if (socket === null || typeof socket.send !== 'function') return false
    try {
      socket.send(JSON.stringify(event))
      return true
    } catch (error) {
      log('send failed', error)
      return false
    }
  }

  function broadcast(event: unknown): number {
    let count = 0
    for (const socket of sockets) {
      if (send(socket, event)) count++
    }
    return count
  }

  function openSession(agent: string, sessionId: string, reason?: string): boolean {
    const set = connections.get(agent)
    if (set === undefined || set.size === 0) return false
    const event = { type: 'session/open' as const, agent, sessionId, ...(reason ? { reason } : {}) }
    let count = 0
    for (const socket of set) {
      if (send(socket, event)) count++
    }
    return count > 0
  }

  function handleHello(event: Record<string, unknown>, socket: WsLike): boolean {
    const agent = typeof event.agent === 'string' && event.agent !== '' ? event.agent : ''
    if (agent === '') return false
    if (event.protocolVersion !== PROTOCOL_VERSION) {
      try {
        socket.close(1008, `unsupported protocol version: ${String(event.protocolVersion)}`)
      } catch {
        // ignore close errors
      }
      sockets.delete(socket)
      return false
    }
    registerAgent(agent, socket)
    // Echo the hello back so clients can confirm the desktop pet accepted the
    // handshake and is speaking the same protocol version.
    send(socket, { type: 'hello', agent, protocolVersion: PROTOCOL_VERSION })
    options.onConnect?.(agent, socket)
    return true
  }

  function handleSnapshot(event: Record<string, unknown>): void {
    const agent = typeof event.agent === 'string' && event.agent !== '' ? event.agent : null
    const sessions = Array.isArray(event.sessions) ? event.sessions : []
    if (agent !== null && sessions.length > 0) {
      if (typeof (store as any).applySnapshot === 'function') {
        store.applySnapshot(agent, sessions)
      } else {
        store.handle({ type: 'snapshot', agent, sessions: sessions as any })
      }
    }
  }

  function handleMessage(data: unknown, socket: WsLike): void {
    if (socket !== null && typeof socket === 'object') sockets.add(socket)
    const value = parseData(data)
    if (value === null || typeof value !== 'object') return
    const result = validatePetEvent(value)
    if (!result.ok) {
      log('dropping invalid pet event', result.errors)
      return
    }
    const event = result.value as PetEvent & Record<string, unknown>
    const agent = typeof event.agent === 'string' && event.agent !== '' ? event.agent : ''

    // A hello is the versioned handshake. Other valid events also implicitly
    // identify their source and are allowed only after (or as) a hello.
    if (event.type === 'hello') {
      handleHello(event, socket)
      options.onEvent?.(event, serverApi)
      notify()
      return
    }

    if (agent !== '') registerAgent(agent, socket)

    switch (event.type) {
      case 'snapshot':
        handleSnapshot(event)
        break
      case 'session/sync':
        store.sync(agent, Array.isArray(event.sessionIds) ? event.sessionIds : [])
        break
      case 'session/directory':
        store.handle(event as unknown as SessionStoreEvent)
        break
      default:
        store.handle(event)
        break
    }
    options.onEvent?.(event, serverApi)
    notify()
  }

  function handleConnection(socket: WsLike): void {
    if (socket === null || typeof socket !== 'object') return
    if (sockets.has(socket)) return
    sockets.add(socket)
    // Prefer the Node-style EventEmitter API; fall back to EventTarget for
    // lightweight test doubles or browser-like sockets.
    if (typeof socket.on === 'function') {
      socket.on('message', (data: unknown) => handleMessage(data, socket))
      socket.on('close', () => handleClose(socket))
      socket.on('error', () => { /* keep close as the authority */ })
    } else if (typeof (socket as any).addEventListener === 'function') {
      const target = socket as any
      target.addEventListener?.('message', (event: any) => handleMessage(event?.data ?? event, socket))
      target.addEventListener?.('close', () => handleClose(socket))
    } else if ('onmessage' in socket || 'onclose' in socket) {
      const target = socket as any
      target.onmessage = (event: any) => handleMessage(event?.data ?? event, socket)
      target.onclose = () => handleClose(socket)
    }
  }

  function handleEvent(data: unknown, socket: WsLike): void {
    handleMessage(data, socket)
  }

  function handleIncoming(data: unknown, socket: WsLike): void {
    handleMessage(data, socket)
  }

  function handleClose(socket: WsLike): void {
    if (!sockets.has(socket)) return
    sockets.delete(socket)
    let disconnectedAgent: string | null = null
    for (const [agent, set] of connections) {
      if (set.delete(socket)) {
        disconnectedAgent = agent
        if (set.size === 0) {
          connections.delete(agent)
          // The bridge is the source of truth for its sessions while it is
          // online; when the last connection for an agent goes away, drop its
          // cached activities so the pet falls back to idle. A reconnect
          // restores them from the handshake snapshot.
          try {
            store.sync(agent, [])
          } catch {
            // If a custom store does not implement sync, keep cached data.
          }
        }
      }
    }
    options.onDisconnect?.(disconnectedAgent, socket)
    notify()
  }

  function activeActivities(): SessionStoreActivity[] {
    if (connections.size === 0) return []
    const agents = new Set(connections.keys())
    return store.activities().filter((activity) => activity.agent !== null && agents.has(activity.agent))
  }

  function activityList(): SessionStoreActivity[] {
    return activeActivities()
  }

  function trayActivities(): SessionStoreActivity[] {
    return activeActivities().filter((activity) => activity.reminder)
  }

  function activities(): SessionStoreActivity[] {
    return activeActivities()
  }

  function tray(): SessionStoreActivity[] {
    return trayActivities()
  }

  function allActivities(): SessionStoreActivity[] {
    return activeActivities()
  }

  function markAcknowledged(agent: string, sessionId: string): boolean {
    if (typeof agent === 'string' && agent !== '' && typeof sessionId === 'string' && sessionId !== '') {
      store.markAcknowledged(agent, sessionId)
      notify()
      return true
    }
    return false
  }

  function markRead(agent: string, sessionId: string): boolean {
    return markAcknowledged(agent, sessionId)
  }

  function snapshotFor(agent: string): unknown[] {
    return exportSnapshot(agent)
  }

  function exportSnapshot(agent: string): unknown[] {
    if (typeof (store as any).exportSnapshot === 'function') {
      return (store as any).exportSnapshot(agent)
    }
    return []
  }

  function currentActivity(): SessionStoreActivity | null {
    const list = activeActivities()
    // A completed ('ready') session lives only in the tray (已完成 + 绿点);
    // it must never become the pet character's pose. Only live activities
    // (running / waiting / blocked) drive the pet — otherwise relax to idle.
    const live = list.filter((activity) => activity.activityState !== 'ready')
    return live.length > 0 ? live[0] : null
  }

  function currentDisplayState(): string {
    const activity = currentActivity()
    return activity?.activityState ?? 'idle'
  }

  function currentState(): string {
    const activity = currentActivity()
    return activity?.state ?? 'idle'
  }

  function displayState(): string {
    return currentDisplayState()
  }

  function connectedAgents(): string[] {
    return [...connections.keys()]
  }

  function resolveWebSocketServer(): new (options: Record<string, unknown>) => WebSocketServerLike {
    if (options.WebSocketServerImpl !== undefined) return options.WebSocketServerImpl
    if (options.WebSocketServer !== undefined) return options.WebSocketServer
    // Loaded lazily so browser/Vite builds do not need to bundle the Node ws
    // implementation. The server is also only started from a Node context.
    const ws = require('ws') as { WebSocketServer: new (options: Record<string, unknown>) => WebSocketServerLike }
    return ws.WebSocketServer
  }

  function pathnameOf(url: unknown): string {
    if (typeof url !== 'string') return ''
    try {
      return new URL(url, 'http://localhost').pathname
    } catch {
      return ''
    }
  }

  function start(): Promise<PetServer> {
    if (starting !== null) return starting
    if (server !== null) return Promise.resolve(serverApi)
    starting = new Promise<PetServer>((resolve, reject) => {
      try {
        const WSS = resolveWebSocketServer()

        if (usesInjectedServer()) {
          // Test doubles construct a server bound to a single path. Keep the
          // original behavior so the existing suite continues to exercise the
          // same code path.
          const instance = new WSS({ host, port, path })
          server = instance
          instance.on('connection', (socket) => handleConnection(socket))
          instance.on('listening', () => {
            listening = true
            log(`listening on ${host}:${port}${path}`)
            starting = null
            resolve(serverApi)
          })
          instance.on('error', (error) => {
            log('server error', error)
            if (!listening) {
              server = null
              starting = null
              reject(error)
            }
          })

          // Injected/fake servers used by unit tests often do not emit a real
          // 'listening' event. Treat construction as ready in that mode.
          setImmediate(() => {
            if (!listening) {
              listening = true
              starting = null
              resolve(serverApi)
            }
          })
          return
        }

        // Real mode: host one HTTP server and route both the public bridge
        // path and app-internal delegate paths (e.g. /v1/ui) to the same WS
        // server. This keeps the desktop pet's control plane private without
        // opening a second port.
        const http = require('node:http') as typeof import('node:http')
        const httpInstance = http.createServer((_req, res) => {
          res.statusCode = 404
          res.end()
        })
        const instance = new WSS({ noServer: true })
        server = instance
        httpServer = httpInstance
        const delegatePaths = new Set(Object.keys(options.delegates ?? {}))
        instance.on('connection', (socket, req) => {
          const pathname = pathnameOf((req as { url?: string } | undefined)?.url)
          if (pathname === path) {
            handleConnection(socket)
            return
          }
          const delegate = options.delegates?.[pathname]
          if (delegate !== undefined) {
            delegate(socket, req)
            return
          }
          try {
            socket.close(1008, 'unknown path')
          } catch {
            // ignore
          }
        })
        instance.on('error', (error) => {
          log('server error', error)
          if (!listening) {
            server = null
            httpServer = null
            starting = null
            reject(error)
          }
        })
        httpInstance.on('upgrade', (req, socket, head) => {
          const pathname = pathnameOf(req.url)
          if (pathname === path || delegatePaths.has(pathname)) {
            const raw = instance as unknown as {
              handleUpgrade?(req: unknown, socket: unknown, head: unknown, cb: (socket: WsLike) => void): void
            }
            raw.handleUpgrade?.(req, socket, head, (ws) => {
              ;(instance as unknown as { emit?: (event: string, ...args: unknown[]) => void }).emit?.('connection', ws, req)
            })
          } else {
            try {
              (socket as { destroy?: () => void }).destroy?.()
            } catch {
              // ignore
            }
          }
        })
        httpInstance.on('error', (error) => {
          log('http server error', error)
          if (!listening) {
            server = null
            httpServer = null
            starting = null
            reject(error)
          }
        })
        httpInstance.listen(port, host, () => {
          listening = true
          log(`listening on ${host}:${port}${path}`)
          starting = null
          resolve(serverApi)
        })
      } catch (error) {
        starting = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return starting
  }

  function stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (server === null) {
        listening = false
        sockets.clear()
        connections.clear()
        httpServer = null
        resolve()
        return
      }
      const current = server
      const currentHttp = httpServer
      server = null
      httpServer = null
      listening = false
      for (const socket of sockets) {
        try {
          socket.close(1001, 'desktop pet shutting down')
        } catch {
          // ignore
        }
      }
      sockets.clear()
      connections.clear()
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      if (typeof current.close === 'function') {
        current.close(finish)
        // Some test doubles do not invoke the close callback; do not hang.
        setImmediate(finish)
      } else {
        finish()
      }
      // In real mode the WebSocketServer is noServer-based and the HTTP server
      // is owned by this module; close it so the port is released.
      if (currentHttp !== null && typeof currentHttp.close === 'function') {
        try {
          currentHttp.close(() => {})
        } catch {
          // ignore shutdown errors
        }
      }
    })
  }

  function isListening(): boolean {
    return listening
  }

  function isOnline(): boolean {
    return connections.size > 0
  }

  function isConnected(): boolean {
    return connections.size > 0
  }

  function hasClients(): boolean {
    return connections.size > 0
  }

  function getPort(): number | null {
    return address()?.port ?? null
  }

  function url(): string {
    const actual = getPort() ?? port
    return `ws://${host}:${actual}${path}`
  }

  function getUrl(): string {
    return url()
  }

  function address(): { port: number } | null {
    if (httpServer !== null && typeof httpServer.address === 'function') {
      const addr = httpServer.address() as { port?: number } | null
      if (addr !== null && typeof addr === 'object' && typeof addr.port === 'number') {
        return { port: addr.port }
      }
      return null
    }
    if (server === null) return null
    const current = server as WebSocketServerLike & { address?: () => { port: number } | { address: string; port: number } | null }
    if (typeof current.address !== 'function') return null
    const addr = current.address()
    if (addr === null || typeof addr !== 'object') return null
    return { port: addr.port }
  }

  const serverApi: PetServer = {
    host,
    port,
    path,
    store,
    connections,
    get clients() { return sockets },
    get agents() { return [...connections.keys()] },
    get wsUrl() { return url() },
    get actualPort() { return getPort() },
    getUrl,
    start,
    listen: start,
    stop,
    close: stop,
    isListening,
    isOnline,
    isConnected,
    hasClients,
    address,
    getPort,
    url,
    handleConnection,
    handleClose,
    handleMessage,
    handleEvent,
    handleIncoming,
    activeActivities,
    activityList,
    trayActivities,
    activities,
    tray,
    allActivities,
    markAcknowledged,
    markRead,
    exportSnapshot,
    snapshotFor,
    currentActivity,
    currentDisplayState,
    currentState,
    displayState,
    connectedAgents,
    openSession,
    send,
    broadcast,
    subscribe,
    onChange,
  }

  Object.setPrototypeOf(serverApi, createPetServer.prototype)
  return serverApi
}

export const DEFAULT_HOST = '127.0.0.1'
export { PROTOCOL_PATH, PROTOCOL_VERSION, DEFAULT_PORT, DEFAULT_WS_URL }

/** Convenience alias for callers that prefer the "desktop pet" wording. */
export const createDesktopPetServer = createPetServer

/** Start a server immediately and return the running instance. */
export async function startPetServer(options: PetServerOptions = {}): Promise<PetServer> {
  return createPetServer(options).start()
}

/** Another alias for discoverability in the desktop app. */
export const createPetWebSocketServer = createPetServer

/**
 * Bind a renderer-like object to a running server. Whenever the server read
 * model changes, the renderer receives the current display state and bubble.
 */
export function bindRenderer(
  server: PetServer,
  renderer: { setState(state: string): void; setBubble(key: string | null, params?: Record<string, unknown> | null): void },
): () => void {
  function update(): void {
    const activity = server.currentActivity()
    renderer.setState(activity?.activityState ?? 'idle')
    renderer.setBubble(activity?.bubbleKey ?? 'idle', activity?.bubbleParams ?? null)
  }
  update()
  if (typeof server.subscribe !== 'function') return () => {}
  return server.subscribe(() => update())
}

export const connectRenderer = bindRenderer

/** Generic alias. */
export const startServer = startPetServer
export const createServer = createPetServer

export default createPetServer

/** Class-like value alias so `new PetServer()` also works. */
export const PetServer = createPetServer
export const DesktopPetServer = createPetServer
