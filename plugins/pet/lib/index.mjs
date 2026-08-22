import { createRequire } from 'node:module'

import {
  DEFAULT_PORT,
  DEFAULT_WS_URL,
  PROTOCOL_VERSION,
  createSessionKey,
  validatePetEvent,
} from '@yshark/pet-protocol'

const require = createRequire(import.meta.url)

export const name = 'pet'
export const inject = []

export const BRIDGE_AGENT = 'dsh'
export const DEFAULT_RECONNECT_MS = 1000
export const MAX_RECONNECT_MS = 30000

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
  for (const container of [entry.summary, entry.meta]) {
    if (container !== null && typeof container === 'object') {
      for (const key of ['title', 'displayTitle', 'name']) {
        const v = container[key]
        if (typeof v === 'string' && v !== '') return v
      }
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
      // fall through to ctx.sessions
    }
  }
  return ctx && typeof ctx === 'object' ? ctx.sessions : undefined
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
  const log = (msg, ...args) => {
    if (logger && typeof logger.info === 'function') logger.info(`[pet-bridge] ${msg}`, ...args)
  }

  let WebSocketImpl = options.WebSocket || ctx?.WebSocket || globalThis.WebSocket
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
  let connected = false
  let retryTimer = null
  let retryAttempt = 0

  const knownSessions = new Map()
  const childParent = new Map()
  const liveIds = new Set()

  function ensureSession(sid) {
    let info = knownSessions.get(sid)
    if (info === undefined) {
      info = {
        state: 'idle',
        pendingKind: null,
        lastEventAt: 0,
        running: false,
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

  function refreshSessions() {
    const service = getSessionsService(ctx)
    const hasStore = Boolean(service && typeof service.list === 'function')
    const list = hasStore ? listSessions(ctx) : []
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
    if (hasStore) {
      liveIds.clear()
      for (const sid of seen) liveIds.add(sid)
      // The DSH session store is authoritative for live top-level sessions.
      for (const sid of [...knownSessions.keys()]) {
        if (!seen.has(sid)) knownSessions.delete(sid)
      }
    } else {
      liveIds.clear()
      for (const sid of knownSessions.keys()) liveIds.add(sid)
    }
    return seen
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
      openSession(sid, event.reason)
    }
  }

  function openSession(sid, reason) {
    const candidates = []
    const sessions = getSessionsService(ctx)
    if (sessions) candidates.push(sessions)
    if (ctx && typeof ctx.openSession === 'function') candidates.push({ open: ctx.openSession })
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
    // Graceful fallback: let any host listener decide how to open the session.
    if (ctx && typeof ctx.emit === 'function') {
      try { ctx.emit('session/open', { sessionId: sid, reason }) } catch { /* no-op */ }
      return true
    }
    log('received session/open but no opener is available', { sessionId: sid, reason })
    return false
  }

  function connect() {
    if (stopped) return
    started = true
    if (socket !== null && (socket.readyState === 0 || socket.readyState === 1)) return
    if (!WebSocketImpl) {
      log('WebSocket implementation unavailable; bridge disabled')
      scheduleReconnect()
      return
    }
    try {
      socket = new WebSocketImpl(url)
    } catch (error) {
      log('websocket construction failed', error)
      socket = null
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      connected = true
      retryAttempt = 0
      log('connected', url)
      sendHello()
      sendSnapshot()
      sendDirectory()
      sendSync()
    }

    socket.onmessage = (event) => {
      const data = event && typeof event === 'object' && 'data' in event ? event.data : event
      handleIncoming(data)
    }

    socket.onerror = (error) => {
      log('websocket error', error)
      if (!connected) scheduleReconnect()
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
    if (stopped) return
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
    if (started) return
    started = true
    stopped = false
    refreshSessions()
    connect()
  }

  function stop() {
    stopped = true
    started = false
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
      const info = clearBlocked(sid)
      touch(sid)
      const status = payload && payload.status === 'running' ? 'running' : 'idle'
      info.running = status === 'running'
      computeState(sid)
      send({ type: 'session/status', agent, sessionId: sid, status })
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
    refreshSessions,
    snapshotSessions,
    directoryEntries,
    sessionIds,
    get knownSessions() { return knownSessions },
    get liveSessionIds() { return [...liveIds] },
    get connected() { return connected },
    get socket() { return socket },
    get url() { return url },
    get agent() { return agent },
  }
}

export function apply(ctx, options = {}) {
  const bridge = createBridge(ctx, options)
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => {
      bridge.start()
      return () => bridge.stop()
    }, 'dsh-pet: bridge websocket client')
  }
  bridge.start()
  return bridge
}

export { createSessionKey, DEFAULT_PORT, DEFAULT_WS_URL, PROTOCOL_VERSION }
