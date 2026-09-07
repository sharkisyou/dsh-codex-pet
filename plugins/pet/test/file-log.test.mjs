import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, createFileLog, formatLogArg, resolveLogFile } from '../lib/index.mjs'

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'pet-bridge-filelog-'))
}

async function waitFor(cond, ms = 2000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 20))
  }
}

class FakeWebSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 0
    FakeWebSocket.instances.push(this)
  }
  send() {}
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

function fakeCtx() {
  const sessions = { list: () => [], get: () => undefined }
  return {
    logger: { info() {} },
    on() {},
    effect(fn) {
      return fn()
    },
    get(key) {
      if (key === 'sessions') return sessions
      return undefined
    },
    sessions,
  }
}

test('createFileLog appends lines and creates parent dirs', async () => {
  const dir = tmpDir()
  const file = join(dir, 'nested', 'bridge.log')
  const log = createFileLog(file)
  assert.ok(log)
  log.append('line-1')
  log.append('line-2')
  await log.flush()
  assert.match(readFileSync(file, 'utf8'), /line-1\nline-2\n/)
  rmSync(dir, { recursive: true, force: true })
})

test('createFileLog rotates to .old when maxBytes exceeded', async () => {
  const dir = tmpDir()
  const file = join(dir, 'bridge.log')
  const log = createFileLog(file, { maxBytes: 64, rotateCheckMs: 0 })
  log.append('a'.repeat(100))
  await log.flush()
  log.append('b'.repeat(100))
  await log.flush()
  assert.ok(existsSync(`${file}.old`))
  assert.match(readFileSync(`${file}.old`, 'utf8'), /a{100}/)
  assert.match(readFileSync(file, 'utf8'), /^b{100}\n$/)
  rmSync(dir, { recursive: true, force: true })
})

test('createFileLog returns null for empty/null path', () => {
  assert.equal(createFileLog(null), null)
  assert.equal(createFileLog(''), null)
  assert.equal(createFileLog(undefined), null)
})

test('formatLogArg formats errors, event-likes, plain objects', () => {
  const err = new Error('boom')
  assert.match(formatLogArg(err), /^Error: boom/)
  assert.ok(!formatLogArg(err).includes('\n'), '输出必须单行（日志一行一条）')
  assert.equal(formatLogArg('plain'), 'plain')
  assert.equal(formatLogArg(42), '42')
  assert.equal(formatLogArg({ a: 1 }), '{"a":1}')
  assert.equal(formatLogArg({ type: 'error', message: 'conn refused' }), 'Object(type=error, message=conn refused)')
  // ErrorEvent 形状（含嵌套 error）：JSON.stringify 会丢 message/error，须展开
  const withInner = { type: 'error', message: 'ws fail', error: new Error('ECONNREFUSED') }
  assert.match(formatLogArg(withInner), /^Object\(type=error, message=ws fail, error=Error: ECONNREFUSED\b/)
  assert.ok(!formatLogArg(withInner).includes('\n'), '嵌套错误也必须单行')
  const circular = {}
  circular.self = circular
  assert.equal(formatLogArg(circular), '[object Object]')
})

test('resolveLogFile: options 优先，env 次之，缺省默认路径', () => {
  const home = homedir()
  const prev = process.env.DSH_PET_LOG
  try {
    delete process.env.DSH_PET_LOG
    assert.equal(resolveLogFile(null), null)
    assert.equal(resolveLogFile(false), null)
    assert.equal(resolveLogFile('/tmp/custom.log'), '/tmp/custom.log')
    assert.equal(resolveLogFile(undefined), join(home, '.dsh', 'logs', 'pet-bridge.log'))
    process.env.DSH_PET_LOG = '0'
    assert.equal(resolveLogFile(undefined), null)
    process.env.DSH_PET_LOG = 'false'
    assert.equal(resolveLogFile(undefined), null)
    process.env.DSH_PET_LOG = ''
    assert.equal(resolveLogFile(undefined), null)
    process.env.DSH_PET_LOG = '1'
    assert.equal(resolveLogFile(undefined), join(home, '.dsh', 'logs', 'pet-bridge.log'))
    process.env.DSH_PET_LOG = '/tmp/from-env.log'
    assert.equal(resolveLogFile(undefined), '/tmp/from-env.log')
    assert.equal(resolveLogFile('/tmp/options-wins.log'), '/tmp/options-wins.log')
  } finally {
    if (prev === undefined) delete process.env.DSH_PET_LOG
    else process.env.DSH_PET_LOG = prev
  }
})

test('bridge tees lifecycle logs to options.logFile', async () => {
  const dir = tmpDir()
  const file = join(dir, 'bridge.log')
  FakeWebSocket.instances = []
  const bridge = apply(fakeCtx(), { WebSocket: FakeWebSocket, logFile: file })
  try {
    const ws = FakeWebSocket.instances[0]
    assert.ok(ws, 'bridge should have constructed a websocket')
    ws.open()
    ws.close()
    await waitFor(() => existsSync(file) && readFileSync(file, 'utf8').includes('disconnected'))
    const content = readFileSync(file, 'utf8')
    assert.match(content, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[pet-bridge\] bridge starting /m)
    assert.match(content, /\[pet-bridge\] connected /)
    assert.match(content, /\[pet-bridge\] disconnected/)
    // websocket error 的 lastError 不再是 "[object ErrorEvent]"
    ws.onerror?.({ type: 'error', message: 'connection refused' })
    assert.match(bridge.getStatus().lastError, /connection refused/)
  } finally {
    bridge.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bridge honors DSH_PET_LOG env path when options.logFile absent', async () => {
  const dir = tmpDir()
  const file = join(dir, 'env.log')
  const prev = process.env.DSH_PET_LOG
  process.env.DSH_PET_LOG = file
  try {
    FakeWebSocket.instances = []
    const bridge = apply(fakeCtx(), { WebSocket: FakeWebSocket })
    bridge.stop()
    await waitFor(() => existsSync(file) && readFileSync(file, 'utf8').includes('bridge starting'))
    assert.match(readFileSync(file, 'utf8'), /\[pet-bridge\] bridge starting/)
  } finally {
    if (prev === undefined) delete process.env.DSH_PET_LOG
    else process.env.DSH_PET_LOG = prev
    rmSync(dir, { recursive: true, force: true })
  }
})
