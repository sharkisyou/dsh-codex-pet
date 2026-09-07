import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileLog, formatLogArg, resolveServerLogFile, teeConsole } from '../src/file-log.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pet-file-log-'))
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 20))
  }
}

test('createFileLog appends lines and creates parent dirs', async () => {
  const dir = tmpDir()
  const file = join(dir, 'nested', 'server.log')
  const log = createFileLog(file)
  assert.ok(log, 'log should be created')
  log!.append('line-1')
  log!.append('line-2')
  await log!.flush()
  assert.ok(existsSync(file), 'parent dirs + file created')
  const content = readFileSync(file, 'utf8')
  assert.match(content, /line-1\nline-2\n/)
  rmSync(dir, { recursive: true, force: true })
})

test('createFileLog rotates to .old when maxBytes exceeded', async () => {
  const dir = tmpDir()
  const file = join(dir, 'server.log')
  const log = createFileLog(file, { maxBytes: 64, rotateCheckMs: 0 })
  log!.append('a'.repeat(100))
  await log!.flush()
  log!.append('b'.repeat(100))
  await log!.flush()
  assert.ok(existsSync(`${file}.old`), 'rotated copy exists')
  assert.match(readFileSync(`${file}.old`, 'utf8'), /a{100}/)
  assert.match(readFileSync(file, 'utf8'), /^b{100}\n$/, 'current file holds only the post-rotate line')
  rmSync(dir, { recursive: true, force: true })
})

test('createFileLog returns null for empty/null path and never throws', async () => {
  assert.equal(createFileLog(null), null)
  assert.equal(createFileLog(''), null)
  assert.equal(createFileLog(undefined), null)
})

test('resolveServerLogFile: default path, custom path, disabled', () => {
  const home = process.env.HOME ?? ''
  assert.equal(resolveServerLogFile({}), join(home, '.dsh', 'logs', 'pet-server.log'))
  assert.equal(resolveServerLogFile({ PET_SERVER_LOG: '1' }), join(home, '.dsh', 'logs', 'pet-server.log'))
  assert.equal(resolveServerLogFile({ PET_SERVER_LOG: '/tmp/x.log' }), '/tmp/x.log')
  assert.equal(resolveServerLogFile({ PET_SERVER_LOG: '0' }), null)
  assert.equal(resolveServerLogFile({ PET_SERVER_LOG: 'false' }), null)
  assert.equal(resolveServerLogFile({ PET_SERVER_LOG: '' }), null)
})

test('formatLogArg formats errors, event-likes, plain objects', () => {
  const err = new Error('boom')
  assert.match(formatLogArg(err), /^Error: boom/)
  assert.equal(formatLogArg('plain'), 'plain')
  assert.equal(formatLogArg(42), '42')
  assert.equal(formatLogArg({ a: 1 }), '{"a":1}')
  const eventLike = { type: 'error', message: 'conn refused' }
  assert.equal(formatLogArg(eventLike), "Object(type=error, message=conn refused)")
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.equal(formatLogArg(circular), '[object Object]')
})

test('teeConsole mirrors console output to file, idempotent', async () => {
  const dir = tmpDir()
  const file = join(dir, 'tee.log')
  const log = createFileLog(file)!
  const originals = [console.log, console.warn, console.error]
  try {
    teeConsole(log)
    teeConsole(log) // 幂等：不应双重包裹
    console.log('hello', { a: 1 })
    console.error('bad', new Error('x'))
    await log.flush()
    const content = readFileSync(file, 'utf8')
    assert.match(content, /hello \{"a":1\}/)
    assert.match(content, /bad Error: x/)
    // 幂等检查：我们的行恰好各出现一次（测试运行器自身的输出也会进文件，不能按总行数断言）
    const helloCount = content.split('hello {"a":1}').length - 1
    const badCount = content.split('bad Error: x').length - 1
    assert.equal(helloCount, 1, 'double tee 会把 hello 行写两次')
    assert.equal(badCount, 1, 'double tee 会把 bad 行写两次')
  } finally {
    console.log = originals[0]
    console.warn = originals[1]
    console.error = originals[2]
  }
  rmSync(dir, { recursive: true, force: true })
})
