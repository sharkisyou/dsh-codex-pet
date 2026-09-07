import { createRequire } from 'node:module'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  DEFAULT_PORT,
  DEFAULT_WS_URL,
  PROTOCOL_VERSION,
  createSessionKey,
  validatePetEvent,
} from '@yshark/pet-protocol'

const require = createRequire(import.meta.url)

export const name = 'pet'
export const inject = ['webServer']

export const BRIDGE_AGENT = 'dsh'
export const DEFAULT_RECONNECT_MS = 1000
export const MAX_RECONNECT_MS = 30000

const LOG_MAX_BYTES = 2 * 1024 * 1024
const LOG_ROTATE_CHECK_MS = 60_000
const LOG_LINE_MAX = 2000

/** 安全序列化日志附加参数：Error 取 stack 前几行（压成单行）、ErrorEvent 取 type/message、普通对象 JSON。 */
export function formatLogArg(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    const stack = typeof value.stack === 'string' && value.stack !== ''
      ? value.stack.split('\n').slice(0, 4).join(' | ')
      : ''
    return stack || `${value.name}: ${value.message}`
  }
  if (value !== null && typeof value === 'object') {
    // ErrorEvent/Event 形状的对象：JSON.stringify 会丢 message/error 字段
    const eventLike = (typeof value.type === 'string' && typeof value.message === 'string') || value.error instanceof Error
    if (eventLike) {
      const inner = value.error instanceof Error ? `, error=${formatLogArg(value.error)}` : ''
      const name = value.constructor?.name ?? 'Event'
      return `${name}(type=${value.type ?? ''}${value.message ? `, message=${value.message}` : ''}${inner})`
    }
    try { return JSON.stringify(value) } catch { return Object.prototype.toString.call(value) }
  }
  return String(value)
}

/** lastError 用紧凑格式（不带多行 stack），避免 /pet/bridge/status 响应难读。 */
function errorText(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  return formatLogArg(value)
}

/**
 * 桥接文件日志：把 log() 输出 tee 到磁盘。宿主控制台日志随终端滚动消失，
 * 排障需要可回溯的落盘记录（connected/disconnected/websocket error 等关键事件）。
 * 串行追加、超限轮转（保留一份 .old）、任何失败静默——日志绝不影响桥接本身。
 */
export function createFileLog(path, { maxBytes = LOG_MAX_BYTES, rotateCheckMs = LOG_ROTATE_CHECK_MS } = {}) {
  if (typeof path !== 'string' || path === '') return null
  let queue = Promise.resolve()
  let lastRotateCheck = 0
  const append = (line) => {
    queue = queue.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        const now = Date.now()
        if (now - lastRotateCheck >= rotateCheckMs) {
          lastRotateCheck = now
          try {
            const info = await stat(path)
            if (info.size >= maxBytes) await rename(path, `${path}.old`)
          } catch { /* 文件尚不存在，属首写 */ }
        }
        await appendFile(path, `${line}\n`)
      } catch { /* 日志失败绝不影响桥接 */ }
    })
  }
  return { append, path, flush: () => queue }
}

/**
 * 解析日志文件路径。优先级：options.logFile（null/false 显式关闭、字符串为路径）
 * → env DSH_PET_LOG（'0'/'false'/'' 关闭、'1'/'true' 或缺省用默认路径、其他字符串为路径）。
 * 默认路径 ~/.dsh/logs/pet-bridge.log。
 */
export function resolveLogFile(optionsValue) {
  if (optionsValue === null || optionsValue === false) return null
  if (typeof optionsValue === 'string' && optionsValue !== '') return optionsValue
  const env = process.env.DSH_PET_LOG
  if (env === '0' || env === 'false' || env === '') return null
  if (env !== undefined && env !== '1' && env !== 'true') return env
  return join(homedir(), '.dsh', 'logs', 'pet-bridge.log')
}

function safeString(value, fallback = '') {
  if (typeof value === 'string' && value !== '') return value
  return fallback
}

function sessionIdOf(value) {
  if (typeof value === 'string' && value !== '') return value
  if (value === null || typeof value !== 'object') return null
  for (const key of ['sessionId', 'id', 'key']) {
    const v = value[key]
    if (typeof v === 'string' && v !== '') return v
  }
  return null
}

function childIdOf(value) {
  if (value !== null && typeof value === 'object' && typeof value.childSessionId === 'string' && value.childSessionId !== '') {
    return value.childSessionId
  }
  return sessionIdOf(value)
}

function parentIdOfValue(value) {
  if (typeof value === 'string' && value !== '') return value
  if (value !== null && typeof value === 'object') return sessionIdOf(value)
  return null
}

function sessionIdOfEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null
  if (typeof entry.id === 'string' && entry.id !== '') return entry.id
  if (typeof entry.sessionId === 'string' && entry.sessionId !== '') return entry.sessionId
  const header = entry.header ?? (typeof entry.session === 'object' && entry.session !== null ? entry.session.header : null)
  if (header && typeof header.id === 'string' && header.id !== '') return header.id
  if (header && typeof header.sessionId === 'string' && header.sessionId !== '') return header.sessionId
  return null
}

function titleOfEntry(entry) {
  if (entry === null || typeof entry !== 'object') return null
  for (const key of ['title', 'displayTitle', 'name']) {
    const v = entry[key]
    if (typeof v === 'string' && v !== '') return v
  }
  // DSH 0.1.2+ (rc/alpha) host session summaries carry the folded title in the
  // `title` projection view: { projections: { values: { title: { title, ... } } } }.
  const projections = entry.projections
  if (projections !== null && typeof projections === 'object') {
    const values = projections.values
    if (values !== null && typeof values === 'object') {
      const titleValue = values.title
      if (typeof titleValue === 'string' && titleValue !== '') return titleValue
      if (titleValue !== null && typeof titleValue === 'object') {
        for (const key of ['title', 'displayTitle', 'name']) {
          const v = titleValue[key]
          if (typeof v === 'string' && v !== '') return v
        }
      }
    }
  }
  for (const container of [entry.summary, entry.meta]) {
    if (container !== null && typeof container === 'object') {
      for (const key of ['title', 'displayTitle', 'name']) {
        const v = container[key]
        if (typeof v === 'string' && v !== '') return v
      }
    }
  }
  // DSH 0.1.2+ low-level SessionStore entries are live Session objects whose
  // log (entry.log / entry.eventsSnapshot) holds the `session/title` event.
  // Fold the latest one (same convention as the official session-title service).
  for (const log of [entry.log, entry.eventsSnapshot]) {
    if (!Array.isArray(log)) continue
    for (let i = log.length - 1; i >= 0; i--) {
      const event = log[i]
      if (event === null || typeof event !== 'object' || event.type !== 'session/title') continue
      const data = event.data
      const title = data !== null && typeof data === 'object' ? data.title : undefined
      if (typeof title === 'string' && title !== '') return title
    }
  }
  const header = entry.header ?? (typeof entry.session === 'object' && entry.session !== null ? entry.session.header : null)
  if (header !== null && typeof header === 'object') {
    for (const key of ['title', 'displayTitle', 'name']) {
      const v = header[key]
      if (typeof v === 'string' && v !== '') return v
    }
    const meta = header.meta
    if (meta !== null && typeof meta === 'object') {
      for (const inner of ['title', 'displayTitle', 'name']) {
        const v = meta[inner]
        if (typeof v === 'string' && v !== '') return v
      }
    }
  }
  return null
}

function isChildSession(entry) {
  if (entry === null || typeof entry !== 'object') return false
  if (entry.origin === 'subagent' || entry.parentId || entry.parentSession || entry.parentSessionId) return true
  const summary = entry.summary
  if (summary !== null && typeof summary === 'object' && (summary.origin === 'subagent' || summary.parentId || summary.parentSession || summary.parentSessionId)) return true
  const header = entry.header ?? (typeof entry.session === 'object' && entry.session !== null ? entry.session.header : null)
  if (header !== null && typeof header === 'object') {
    if (header.parentSession || header.parentId || header.parentSessionId || header.parent) return true
    const meta = header.meta
    if (meta !== null && typeof meta === 'object' && (meta.parentSession || meta.parentId || meta.parent)) return true
  }
  return false
}

function toolNameOf(exec) {
  if (exec === null || typeof exec !== 'object') return 'tool'
  if (typeof exec.name === 'string' && exec.name !== '') return exec.name
  if (exec.tool !== null && typeof exec.tool === 'object' && typeof exec.tool.name === 'string' && exec.tool.name !== '') {
    return exec.tool.name
  }
  return 'tool'
}

function subagentNameOf(info) {
  if (info === null || typeof info !== 'object') return undefined
  if (typeof info.name === 'string' && info.name !== '') return info.name
  if (typeof info.toolName === 'string' && info.toolName !== '') return info.toolName
  if (info.tool !== null && typeof info.tool === 'object' && typeof info.tool.name === 'string' && info.tool.name !== '') {
    return info.tool.name
  }
  return undefined
}

function promptOf(exec) {
  if (exec === null || typeof exec !== 'object') return undefined
  const candidateKeys = ['prompt', 'question', 'message', 'text', 'input']
  for (const key of candidateKeys) {
    const v = exec[key]
    if (typeof v === 'string' && v !== '') return v
  }
  if (typeof exec.arguments === 'string' && exec.arguments !== '') {
    try {
      const parsed = JSON.parse(exec.arguments)
      if (parsed !== null && typeof parsed === 'object') {
        for (const key of candidateKeys) {
          const v = parsed[key]
          if (typeof v === 'string' && v !== '') return v
        }
      }
    } catch {
      if (exec.arguments.length <= 4096) return exec.arguments
    }
  }
  if (exec.arguments !== null && typeof exec.arguments === 'object') {
    for (const key of candidateKeys) {
      const v = exec.arguments[key]
      if (typeof v === 'string' && v !== '') return v
    }
  }
  return undefined
}

function answerOf(result) {
  if (typeof result === 'string' && result !== '') return result
  if (result === null || typeof result !== 'object') return undefined
  for (const key of ['answer', 'response', 'text', 'message', 'value']) {
    const v = result[key]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

function getSessionsService(ctx) {
  if (ctx && typeof ctx.get === 'function') {
    try {
      const value = ctx.get('sessions')
      if (value !== undefined) return value
    } catch {
      // fall through below
    }
  }
  if (ctx !== null && typeof ctx === 'object') {
    try {
      if (ctx.sessions !== undefined) return ctx.sessions
    } catch {
      // cordis ctx proxies throw for un-injected names; treat as absent
    }
  }
  return undefined
}

function listSessions(ctx) {
  const service = getSessionsService(ctx)
  if (service && typeof service.list === 'function') {
    try {
      const result = service.list()
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  }
  return []
}

// DSH 0.1.2+ session list may be async (Promise). Resolve either form; on
// timeout/error return [] so callers can keep their event-derived state.
async function pullSessionEntries(ctx, timeoutMs = 8000) {
  const service = getSessionsService(ctx)
  if (!service || typeof service.list !== 'function') return []
  try {
    const result = service.list()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return await Promise.race([
        result,
        new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs)),
      ]).catch(() => [])
    }
    return Array.isArray(result) ? result : []
  } catch {
    return []
  }
}

function parentSessionIdOf(ctx, childId, info) {
  if (childId === null) return null
  if (info !== null && typeof info === 'object') {
    for (const key of ['parentSessionId', 'parentId', 'parentSession', 'parent', 'owner']) {
      const v = info[key]
      if (typeof v === 'string' && v !== '') return v
      if (v !== null && typeof v === 'object') {
        const nested = sessionIdOf(v)
        if (nested !== null) return nested
      }
    }
    if (info.session !== null && typeof info.session === 'object' && info.session.header !== null && typeof info.session.header === 'object') {
      const v = info.session.header.parentSession ?? info.session.header.parentId ?? info.session.header.parentSessionId
      if (typeof v === 'string' && v !== '') return v
    }
  }

  const service = getSessionsService(ctx)
  if (service && typeof service.get === 'function') {
    try {
      const session = service.get(childId)
      const header = session !== null && typeof session === 'object' ? session.header : null
      if (header !== null && typeof header === 'object') {
        const v = header.parentSession ?? header.parentId ?? header.parentSessionId ?? header.parent
        const parent = parentIdOfValue(v)
        if (parent !== null) return parent
      }
      if (session !== null && typeof session === 'object') {
        const v = session.parentSession ?? session.parentId ?? session.parentSessionId ?? session.parent
        const parent = parentIdOfValue(v)
        if (parent !== null) return parent
      }
    } catch {
      // try agents below
    }
  }

  let agents = undefined
  if (ctx && typeof ctx.get === 'function') {
    try { agents = ctx.get('agents') } catch { agents = undefined }
  }
  if (agents && typeof agents.get === 'function') {
    try {
      const agent = agents.get(childId)
      const session = agent !== null && typeof agent === 'object' ? agent.session : null
      const header = session !== null && typeof session === 'object' ? session.header : null
      if (header !== null && typeof header === 'object') {
        const v = header.parentSession ?? header.parentId ?? header.parentSessionId ?? header.parent
        const parent = parentIdOfValue(v)
        if (parent !== null) return parent
      }
      if (session !== null && typeof session === 'object') {
        const v = session.parentSession ?? session.parentId ?? session.parentSessionId ?? session.parent
        const parent = parentIdOfValue(v)
        if (parent !== null) return parent
      }
    } catch {
      // no parent available
    }
  }

  for (const entry of listSessions(ctx)) {
    if (sessionIdOfEntry(entry) === childId) {
      const v = (entry.parentSession ?? entry.parentId ?? entry.parentSessionId ?? entry.parent)
        ?? (entry.header && (entry.header.parentSession ?? entry.header.parentId ?? entry.header.parentSessionId ?? entry.header.parent))
      const parent = parentIdOfValue(v)
      if (parent !== null) return parent
    }
  }
  return null
}

export function createBridge(ctx, options = {}) {
  const logger = ctx?.logger ?? console
  const agent = safeString(options.agent, process.env.DSH_PET_AGENT || BRIDGE_AGENT)
  const url = safeString(options.url, process.env.DSH_PET_URL || DEFAULT_WS_URL)
  const reconnectDelay = Number(options.reconnectDelay ?? process.env.DSH_PET_RECONNECT_MS ?? DEFAULT_RECONNECT_MS)
  const maxReconnectDelay = Number(options.maxReconnectDelay ?? MAX_RECONNECT_MS)
  // Session directory/title refresh cadence for async session stores (rc.1+).
  const refreshMs = Math.max(1000, Number(options.refreshMs ?? process.env.DSH_PET_REFRESH_MS ?? 4000))
  const fileLog = createFileLog(resolveLogFile(options.logFile))
  const log = (msg, ...args) => {
    const detail = args.length ? ` ${args.map(formatLogArg).join(' ')}` : ''
    if (fileLog) fileLog.append(`[${new Date().toISOString()}] [pet-bridge] ${msg}${detail}`.slice(0, LOG_LINE_MAX))
    if (logger && typeof logger.info === 'function') logger.info(`[pet-bridge] ${msg}`, ...args)
  }

  let WebSocketImpl = options.WebSocket || globalThis.WebSocket
  if (!WebSocketImpl) {
    try {
      WebSocketImpl = require('ws')
    } catch {
      WebSocketImpl = null
    }
  }

  let socket = null
  let started = false
  let stopped = false
  let enabled = options.enabled !== false
  let connected = false
  let retryTimer = null
  let retryAttempt = 0
  let lastError = null
  let pullTimer = null
  let lastPushedSignature = null
  // The DSH GUI session the user is currently viewing (client-reported).
  let currentSession = null

  function status() {
    return {
      enabled,
      started,
      connected,
      connecting: Boolean(socket && typeof socket.readyState === 'number' && socket.readyState === 0),
      url,
      agent,
      reconnectAttempt: retryAttempt,
      lastError,
    }
  }

  function setEnabled(next) {
    const value = Boolean(next)
    if (value === enabled) return status()
    enabled = value
    if (enabled) {
      lastError = null
      start()
    } else {
      stop()
    }
    return status()
  }

  function openPet() {
    // NOTE: never access ctx.openPet directly — the cordis ctx is a proxy that
    // throws `cannot get property ... without inject` for un-injected names.
    let hostOpenPet
    if (ctx && typeof ctx.get === 'function') {
      try {
        hostOpenPet = ctx.get('openPet')
      } catch {
        hostOpenPet = undefined
      }
    }
    if (typeof hostOpenPet === 'function') {
      try {
        const result = hostOpenPet()
        if (result && typeof result.catch === 'function') {
          result.catch((error) => log('openPet failed', error))
        }
        return { ok: true, opened: true }
      } catch (error) {
        log('openPet failed', error)
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (ctx && typeof ctx.emit === 'function') {
      try {
        ctx.emit('pet/open', { url, agent })
        return { ok: true, opened: true }
      } catch {
        // fall through
      }
    }
    return { ok: true, opened: false, hint: '请手动启动桌宠应用' }
  }

  const knownSessions = new Map()
  const childParent = new Map()
  const liveIds = new Set()

  // B2：宿主侧“打开会话”待办队列。桌宠托盘点击 → pet server 发 session/open →
  // 桥接收到后除了尝试 ctx.emit（官方 allowlist 转发，升级后可能被抹掉），
  // 一律先入队；GUI 客户端常驻轮询 /pet/bridge/pending-open 取走并 sessions.open()。
  // 队列有界：窗口长期未开时丢弃最旧条目，避免无限增长。
  const pendingOpens = []
  const PENDING_OPEN_MAX = 20

  function queuePendingOpen(sid, reason) {
    if (typeof sid !== 'string' || sid === '') return
    const tail = pendingOpens[pendingOpens.length - 1]
    if (tail !== undefined && tail.sessionId === sid) return
    pendingOpens.push({ sessionId: sid, ...(reason !== undefined ? { reason } : {}), at: Date.now() })
    while (pendingOpens.length > PENDING_OPEN_MAX) pendingOpens.shift()
  }

  function drainPendingOpens() {
    return pendingOpens.splice(0)
  }

  function ensureSession(sid) {
    let info = knownSessions.get(sid)
    if (info === undefined) {
      info = {
        state: 'idle',
        pendingKind: null,
        lastEventAt: 0,
        running: false,
        // A finished background run awaiting review (session/done sent).
        done: false,
        approvalCount: 0,
        questionActive: false,
        subagents: 0,
        title: null,
      }
      knownSessions.set(sid, info)
    }
    return info
  }

  function touch(sid, ts = Date.now()) {
    const info = ensureSession(sid)
    info.lastEventAt = ts
    return info
  }

  function clearBlocked(sid) {
    const info = ensureSession(sid)
    if (info.state === 'blocked') info.state = 'idle'
    return info
  }

  function computeState(sid) {
    const info = ensureSession(sid)
    if (info.state === 'blocked') return info.state
    if (info.approvalCount > 0 || info.questionActive) {
      info.state = 'waiting'
      info.pendingKind = info.approvalCount > 0 ? 'approval' : 'question'
      return info.state
    }
    if (info.subagents > 0 || info.running) {
      info.state = 'running'
      info.pendingKind = null
      return info.state
    }
    info.state = 'idle'
    info.pendingKind = null
    return info.state
  }

  // Apply one session-store snapshot to the bridge's knownSessions/liveIds.
  // Semantics:
  // - non-empty list → authoritative: reconcile liveIds and drop gone sessions
  //   (drives disposal).
  // - empty list with a store → no new information (async store mid-flight or
  //   genuinely empty): keep the current event-derived liveIds untouched.
  // - no store at all → liveIds mirror event-derived knownSessions.
  function applyEntries(entries) {
    const list = Array.isArray(entries) ? entries : []
    const service = getSessionsService(ctx)
    const hasStore = Boolean(service && typeof service.list === 'function')
    const seen = new Set()
    for (const entry of list) {
      if (isChildSession(entry)) continue
      const sid = sessionIdOfEntry(entry)
      if (sid === null) continue
      const info = ensureSession(sid)
      const title = titleOfEntry(entry)
      if (title !== null) info.title = title
      seen.add(sid)
    }
    for (const sid of seen) ensureSession(sid)
    if (list.length > 0) {
      liveIds.clear()
      for (const sid of seen) liveIds.add(sid)
      // The DSH session store is authoritative for live top-level sessions.
      for (const sid of [...knownSessions.keys()]) {
        if (!seen.has(sid)) knownSessions.delete(sid)
      }
    } else if (!hasStore) {
      liveIds.clear()
      for (const sid of knownSessions.keys()) liveIds.add(sid)
    }
    return seen
  }

  function refreshSessions() {
    const service = getSessionsService(ctx)
    const hasStore = Boolean(service && typeof service.list === 'function')
    const list = hasStore ? listSessions(ctx) : []
    return applyEntries(list)
  }

  // Background async refresh: handles stores whose list() is async (rc.1+).
  function startPullTimer() {
    if (pullTimer !== null) return
    pullTimer = setInterval(() => {
      void pullAndPushIfChanged()
    }, refreshMs)
    if (pullTimer && typeof pullTimer.unref === 'function') pullTimer.unref()
  }

  function stopPullTimer() {
    if (pullTimer !== null) {
      clearInterval(pullTimer)
      pullTimer = null
    }
  }

  function signatureOf() {
    return [...liveIds].sort()
      .map((sid) => `${sid}=${(knownSessions.get(sid)?.title) || ''}`)
      .join('|')
  }

  async function pullAndPushIfChanged() {
    if (stopped || !enabled) return
    const entries = await pullSessionEntries(ctx)
    applyEntries(entries)
    if (!connected || socket === null) return
    const signature = signatureOf()
    if (signature === lastPushedSignature) return
    lastPushedSignature = signature
    sendDirectory()
    sendSync()
  }

  function sessionIds() {
    refreshSessions()
    return [...liveIds]
  }

  function snapshotSessions() {
    refreshSessions()
    const out = []
    for (const [sid, info] of knownSessions) {
      const entry = { sessionId: sid }
      if (info.title) entry.title = info.title
      if (info.lastEventAt > 0) entry.lastEventAt = info.lastEventAt
      if (info.state !== 'idle') {
        entry.state = info.state
        if (info.pendingKind) entry.pendingKind = info.pendingKind
      } else if (info.done) {
        // A completed-but-unviewed session restores as 'ready' on reconnect.
        entry.state = 'ready'
      }
      out.push(entry)
    }
    return out
  }

  function directoryEntries() {
    refreshSessions()
    const out = []
    for (const sid of liveIds) {
      const info = ensureSession(sid)
      const entry = { sessionId: sid, title: info.title || sid }
      if (info.state !== 'idle') entry.state = info.state
      else if (info.done) entry.state = 'ready'
      if (info.lastEventAt > 0) entry.updatedAt = info.lastEventAt
      out.push(entry)
    }
    return out
  }

  function send(event) {
    if (!connected || socket === null || typeof socket.send !== 'function') return false
    const result = validatePetEvent(event)
    if (!result.ok) {
      log('dropping invalid wire event', event, result.errors)
      return false
    }
    try {
      socket.send(JSON.stringify(event))
      return true
    } catch (error) {
      log('send failed', error)
      return false
    }
  }

  function sendHello() {
    return send({ type: 'hello', agent, protocolVersion: PROTOCOL_VERSION })
  }

  function sendSnapshot() {
    return send({ type: 'snapshot', agent, sessions: snapshotSessions() })
  }

  function sendDirectory() {
    return send({ type: 'session/directory', agent, sessions: directoryEntries() })
  }

  function sendSync() {
    return send({ type: 'session/sync', agent, sessionIds: sessionIds() })
  }

  function handleIncoming(data) {
    let event
    try {
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) data = data.toString('utf8')
      if (data instanceof ArrayBuffer) data = Buffer.from(data).toString('utf8')
      event = typeof data === 'string' ? JSON.parse(data) : data
    } catch {
      return
    }
    if (event === null || typeof event !== 'object') return
    if (event.type === 'session/open') {
      const sid = sessionIdOf(event)
      if (sid === null) return
      // The user opened/viewed this session from the tray: its completion is
      // consumed (the pet already acknowledged it on click).
      const info = knownSessions.get(sid)
      if (info) info.done = false
      openSession(sid, event.reason)
    }
  }

  // The GUI client reports the session currently being viewed. Switching to a
  // session consumes its unviewed completion (bridge memory + pet ack).
  function setCurrent(next) {
    const value = typeof next === 'string' && next !== '' ? next : null
    if (value === currentSession) return status()
    const previous = currentSession
    currentSession = value
    if (value !== null) {
      const info = knownSessions.get(value)
      if (info) info.done = false
    }
    if (connected && socket !== null && value !== null) {
      send({ type: 'session/current', agent, sessionId: value })
    }
    log('current session', { previous, current: value })
    return status()
  }

  function openSession(sid, reason) {
    // B2: queue first — the GUI client drains via /pet/bridge/pending-open even
    // when the official allowlist no longer forwards session/open. Then still
    // attempt the forwarded-event path for instant navigation when it works.
    queuePendingOpen(sid, reason)
    // Primary path (current DSH): emit session/open. The host api-proxy
    // forwards allowlisted events to the web client (host/remote-event), whose
    // client plugin navigates to the session. Older DSH hosts that mounted no
    // forwarding fall through to a direct opener API below.
    if (ctx && typeof ctx.emit === 'function') {
      try {
        ctx.emit('session/open', { sessionId: sid, reason })
        return true
      } catch {
        // fall through to legacy opener APIs
      }
    }
    const candidates = []
    const sessions = getSessionsService(ctx)
    if (sessions && typeof sessions.open === 'function') candidates.push(sessions)
    // Proxy-safe legacy opener lookup (never access ctx.openSession directly).
    if (ctx && typeof ctx.get === 'function') {
      try {
        const hostOpen = ctx.get('openSession')
        if (typeof hostOpen === 'function') candidates.push({ open: hostOpen })
      } catch {
        // no openSession service registered
      }
    }
    for (const candidate of candidates) {
      if (candidate && typeof candidate.open === 'function') {
        try {
          const result = candidate.open(sid, reason)
          if (result && typeof result.catch === 'function') {
            result.catch((error) => log('open session failed', error))
          }
          return true
        } catch (error) {
          log('open session failed', error)
        }
      }
    }
    log('received session/open but no opener is available', { sessionId: sid, reason })
    return false
  }

  function connect() {
    if (stopped || !enabled) return
    started = true
    if (socket !== null && (socket.readyState === 0 || socket.readyState === 1)) return
    if (!WebSocketImpl) {
      lastError = 'WebSocket implementation unavailable'
      log('WebSocket implementation unavailable; bridge disabled')
      scheduleReconnect()
      return
    }
    try {
      socket = new WebSocketImpl(url)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error ?? 'websocket construction failed')
      log('websocket construction failed', error)
      socket = null
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      connected = true
      retryAttempt = 0
      lastError = null
      log('connected', url)
      sendHello()
      sendSnapshot()
      sendDirectory()
      sendSync()
      lastPushedSignature = signatureOf()
      // Warm the maps from an async session store (rc.1+) and, when the pulled
      // directory differs from what was just sent, push the corrected view.
      void pullAndPushIfChanged()
    }

    socket.onmessage = (event) => {
      const data = event && typeof event === 'object' && 'data' in event ? event.data : event
      handleIncoming(data)
    }

    socket.onerror = (error) => {
      lastError = errorText(error).slice(0, 300)
      log('websocket error', error)
      if (!connected) {
        const old = socket
        socket = null
        try { old?.close() } catch { /* already closed */ }
        scheduleReconnect()
      }
    }

    socket.onclose = () => {
      if (!connected && socket === null) return
      connected = false
      socket = null
      log('disconnected')
      scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    if (stopped || !enabled) return
    if (retryTimer !== null) return
    const base = Number.isFinite(reconnectDelay) && reconnectDelay > 0 ? reconnectDelay : DEFAULT_RECONNECT_MS
    const delay = Math.min(base * Math.pow(2, retryAttempt), maxReconnectDelay || MAX_RECONNECT_MS)
    retryAttempt++
    log('reconnecting in', delay, 'ms')
    retryTimer = setTimeout(() => {
      retryTimer = null
      connect()
    }, delay)
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref()
  }

  function start() {
    enabled = true
    if (started) return
    lastError = null
    started = true
    stopped = false
    log('bridge starting', { url, agent, logFile: fileLog?.path ?? null })
    refreshSessions()
    startPullTimer()
    void pullAndPushIfChanged()
    connect()
  }

  function stop() {
    enabled = false
    stopped = true
    started = false
    connected = false
    lastPushedSignature = null
    stopPullTimer()
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (socket !== null) {
      const old = socket
      socket = null
      connected = false
      try { old.close() } catch { /* no-op */ }
    }
  }

  function handleSubagentStart(child, parent, info) {
    if (childParent.has(child)) return
    childParent.set(child, parent)
    const parentInfo = clearBlocked(parent)
    touch(parent)
    parentInfo.subagents = (parentInfo.subagents || 0) + 1
    computeState(parent)
    send({
      type: 'subagent/start',
      agent,
      sessionId: parent,
      ...(child ? { childSessionId: child } : {}),
      ...(subagentNameOf(info) ? { name: subagentNameOf(info) } : {}),
    })
  }

  if (ctx && typeof ctx.on === 'function') {
    const onSessionCreated = (session) => {
      const sid = sessionIdOfEntry(session)
      if (sid !== null && !isChildSession(session)) {
        const info = ensureSession(sid)
        const title = titleOfEntry(session)
        if (title !== null) info.title = title
        liveIds.add(sid)
      }
      sendDirectory()
      sendSync()
    }
    const onSessionDisposed = (session) => {
      const sid = sessionIdOfEntry(session)
      if (sid !== null) {
        knownSessions.delete(sid)
        liveIds.delete(sid)
      }
      sendDirectory()
      sendSync()
    }
    ctx.on('session/created', onSessionCreated)
    ctx.on('session/disposed', onSessionDisposed)

    ctx.on('agent/status', (payload) => {
      const sid = sessionIdOf(payload && payload.agent)
      if (sid === null) return
      const info = ensureSession(sid)
      touch(sid)
      const running = Boolean(payload && payload.status === 'running')
      const wasRunning = info.running
      info.running = running
      if (running) {
        // Any run clears a previous completion.
        info.done = false
        if (info.state === 'blocked') info.state = 'idle'
        computeState(sid)
        send({ type: 'session/status', agent, sessionId: sid, status: 'running' })
        return
      }
      // Agent went idle.
      if (info.state === 'blocked') {
        // Error terminal was already reported; the pet keeps 受阻 until viewed.
        computeState(sid)
        send({ type: 'session/status', agent, sessionId: sid, status: 'idle' })
        return
      }
      if (wasRunning && !info.done && info.approvalCount === 0 && !info.questionActive && info.subagents === 0) {
        // A run finished. The currently-viewed session just pauses; background
        // sessions become a persistent "已完成" tray item until viewed.
        if (sid !== currentSession) {
          info.done = true
          computeState(sid)
          send({ type: 'session/done', agent, sessionId: sid, at: Date.now() })
          return
        }
        computeState(sid)
        send({ type: 'session/status', agent, sessionId: sid, status: 'idle' })
        return
      }
      computeState(sid)
      send({ type: 'session/status', agent, sessionId: sid, status: 'idle' })
    })

    ctx.on('agent/error', (payload) => {
      const sid = sessionIdOf(payload && payload.agent)
      if (sid === null) return
      const info = touch(sid)
      info.state = 'blocked'
      info.pendingKind = null
      send({
        type: 'session/error',
        agent,
        sessionId: sid,
        message: safeString(payload && (payload.message ?? payload.error), 'error'),
        ...((payload && typeof payload.kind === 'string' && payload.kind) ? { kind: payload.kind } : {}),
        ...((payload && (typeof payload.code === 'string' || typeof payload.code === 'number')) ? { code: payload.code } : {}),
      })
    })

    ctx.on('tools/execute', (exec, next) => {
      const sid = sessionIdOf(exec && exec.agent)
      if (sid === null) return typeof next === 'function' ? next() : undefined
      const info = clearBlocked(sid)
      touch(sid)
      const name = toolNameOf(exec)
      const isQuestion = name === 'ask_user_question'

      if (isQuestion) {
        info.questionActive = true
        info.state = 'waiting'
        info.pendingKind = 'question'
        const event = { type: 'question/start', agent, sessionId: sid }
        const prompt = promptOf(exec)
        if (prompt !== undefined) event.prompt = prompt
        send(event)
      } else {
        info.running = true
        computeState(sid)
        send({ type: 'tool/start', agent, sessionId: sid, name })
      }

      if (typeof next !== 'function') return undefined
      return (async () => {
        let result
        try {
          result = await next()
          return result
        } finally {
          touch(sid)
          if (isQuestion) {
            info.questionActive = false
            computeState(sid)
            const event = { type: 'question/end', agent, sessionId: sid }
            const answer = answerOf(result)
            if (answer !== undefined) event.answer = answer
            send(event)
          } else {
            computeState(sid)
            send({ type: 'tool/end', agent, sessionId: sid, name })
          }
        }
      })()
    })

    ctx.on('approval/request', (req, next) => {
      const sid = sessionIdOf(req && req.agent)
      if (sid === null) return typeof next === 'function' ? next() : undefined
      const info = clearBlocked(sid)
      touch(sid)
      info.approvalCount = (info.approvalCount || 0) + 1
      info.state = 'waiting'
      info.pendingKind = 'approval'
      send({ type: 'approval/start', agent, sessionId: sid, count: info.approvalCount })

      if (typeof next !== 'function') return undefined
      return (async () => {
        try {
          return await next()
        } finally {
          touch(sid)
          info.approvalCount = Math.max(0, (info.approvalCount || 1) - 1)
          if (info.approvalCount === 0) {
            computeState(sid)
            send({ type: 'approval/end', agent, sessionId: sid, count: 0 })
          } else {
            // Keep waiting until all concurrent approvals have resolved.
            info.state = 'waiting'
            info.pendingKind = 'approval'
          }
        }
      })()
    })

    ctx.on('subagent/start', (info) => {
      const child = childIdOf(info)
      if (child === null) return
      const parent = parentSessionIdOf(ctx, child, info) ?? info.parentSessionId ?? info.parentId
      if (parent === null || parent === undefined) {
        for (const delay of [0, 10, 50, 200]) {
          setTimeout(() => {
            const lateParent = parentSessionIdOf(ctx, child, info) ?? info.parentSessionId ?? info.parentId
            if (lateParent === null || lateParent === undefined) return
            handleSubagentStart(child, lateParent, info)
          }, delay)
        }
        return
      }
      handleSubagentStart(child, parent, info)
    }, { global: true })

    ctx.on('subagent/end', (info) => {
      const child = sessionIdOf(info)
      if (child === null || !childParent.has(child)) return
      const parent = childParent.get(child)
      childParent.delete(child)
      if (parent === null) return
      const parentInfo = touch(parent)
      parentInfo.subagents = Math.max(0, (parentInfo.subagents || 0) - 1)
      computeState(parent)
      send({
        type: 'subagent/end',
        agent,
        sessionId: parent,
        ...(child ? { childSessionId: child } : {}),
        ...(subagentNameOf(info) ? { name: subagentNameOf(info) } : {}),
      })
    }, { global: true })
  }

  return {
    start,
    stop,
    connect,
    scheduleReconnect,
    send,
    sendHello,
    sendSnapshot,
    sendDirectory,
    sendSync,
    handleIncoming,
    openSession,
    setCurrent,
    queuePendingOpen,
    drainPendingOpens,
    refreshSessions,
    snapshotSessions,
    directoryEntries,
    sessionIds,
    getStatus: status,
    setEnabled,
    openPet,
    isEnabled() { return enabled },
    get knownSessions() { return knownSessions },
    get liveSessionIds() { return [...liveIds] },
    get enabled() { return enabled },
    get status() { return status() },
    get connected() { return connected },
    get socket() { return socket },
    get url() { return url },
    get agent() { return agent },
  }
}

export function apply(ctx, options = {}) {
  const bridge = createBridge(ctx, options)
  let httpRegistered = false
  let httpDisposer = undefined

  function webServer() {
    if (ctx && typeof ctx.get === 'function') {
      try {
        const value = ctx.get('webServer')
        if (value !== undefined) return value
      } catch {
        // fall through below
      }
    }
    if (ctx !== null && typeof ctx === 'object') {
      try {
        if (ctx.webServer !== undefined) return ctx.webServer
      } catch {
        // un-injected name on the cordis proxy; treat as absent
      }
    }
    return undefined
  }

  function sendJson(res, statusCode, payload) {
    if (!res || typeof res.writeHead !== 'function') return
    const body = JSON.stringify(payload)
    try {
      res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      res.end(body)
    } catch {
      // response may already be closed; ignore
    }
  }

  async function readJsonBody(req) {
    if (!req || typeof req.on !== 'function') return {}
    return await new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (body === '') return resolve({})
        try {
          resolve(JSON.parse(body))
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })
  }

  function registerHttp() {
    if (httpRegistered) return httpDisposer
    const server = webServer()
    if (!server || typeof server.register !== 'function') return undefined
    httpRegistered = true
    httpDisposer = server.register({
      kind: 'prefix',
      path: '/pet',
      handler: async (req, res) => {
        let pathname = ''
        try {
          pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        } catch {
          sendJson(res, 400, { ok: false, error: '非法请求路径' })
          return
        }
        if (req.method === 'OPTIONS') {
          sendJson(res, 204, {})
          return
        }
        if (pathname === '/pet/bridge/status' && (req.method === 'GET' || req.method === 'HEAD')) {
          sendJson(res, 200, { ok: true, ...bridge.getStatus() })
          return
        }
        if (pathname === '/pet/bridge/enabled' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const next = typeof body.enabled === 'boolean' ? body.enabled : !bridge.isEnabled()
          const status = bridge.setEnabled(next)
          sendJson(res, 200, { ok: true, ...status })
          return
        }
        if (pathname === '/pet/bridge/open' && (req.method === 'POST' || req.method === 'GET')) {
          sendJson(res, 200, { ok: true, ...bridge.openPet() })
          return
        }
        if (pathname === '/pet/bridge/pending-open' && (req.method === 'GET' || req.method === 'HEAD')) {
          // B2: GET 即取即清。客户端常驻轮询此端点，把托盘点击的
          // “打开会话”意图取走并导航，不依赖 DSH 官方 allowlist。
          const opens = bridge.drainPendingOpens()
          sendJson(res, 200, { ok: true, opens })
          return
        }
        if (pathname === '/pet/bridge/current' && (req.method === 'POST' || req.method === 'GET')) {
          const body = await readJsonBody(req)
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
          sendJson(res, 200, { ok: true, current: sessionId ?? null, ...bridge.setCurrent(sessionId) })
          return
        }
        sendJson(res, 404, { ok: false, error: '未知桥接设置接口' })
      },
    })
  }

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => registerHttp(), 'dsh-pet: settings HTTP routes')
    ctx.effect(() => {
      if (bridge.isEnabled()) bridge.start()
      return () => bridge.stop()
    }, 'dsh-pet: bridge websocket client')
  }
  registerHttp()
  if (bridge.isEnabled()) bridge.start()
  return bridge
}

export { createSessionKey, DEFAULT_PORT, DEFAULT_WS_URL, PROTOCOL_VERSION }
