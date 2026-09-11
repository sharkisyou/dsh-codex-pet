import assert from 'node:assert/strict'
import test from 'node:test'

import { petLog, setPetLogScope } from '../src/pet-log.js'

/** 捕获 petLog 落到 console 的行。 */
function captureLines(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '))
  }
  return {
    lines,
    restore: () => {
      console.log = original
    },
  }
}

/** 冻结/推进 Date.now（petLog 用它判断"是否还在重复窗口内"）。 */
function fakeClock(start: number): { set: (value: number) => void; restore: () => void } {
  const original = Date.now
  let now = start
  Date.now = () => now
  return {
    set: (value: number) => {
      now = value
    },
    restore: () => {
      Date.now = original
    },
  }
}

test('连续重复的日志在抑制窗口内只落一行，超窗后带累计次数补一行心跳', () => {
  const clock = fakeClock(1_000_000)
  const { lines, restore } = captureLines()
  try {
    for (let i = 0; i < 5; i++) petLog('ui', 'applyActivity', { state: 'running' })
    assert.equal(lines.length, 1, '窗口内连续 5 条只落 1 行')
    assert.match(lines[0], /\[ui\] applyActivity \{"state":"running"\}$/)

    // 持续重复：窗口从上次落盘起算，每满 5s 补一行心跳，×N = 该窗口内的重复次数。
    clock.set(1_000_000 + 5000)
    petLog('ui', 'applyActivity', { state: 'running' })
    assert.equal(lines.length, 2)
    assert.match(lines[1], /×5$/)
  } finally {
    restore()
    clock.restore()
  }
})

test('内容不同的日志不被抑制；窗口内重现同一行则被压掉', () => {
  const clock = fakeClock(2_000_000)
  const { lines, restore } = captureLines()
  try {
    petLog('renderer', 'setState', { next: 'running' })
    petLog('renderer', 'setState', { next: 'idle' })
    petLog('renderer', 'setState', { next: 'walking' })
    assert.equal(lines.length, 3, '内容变化即落盘')
    assert.doesNotMatch(lines[2], /×/)

    // 按键去重（不要求相邻）：窗口内回到写过的内容 → 压掉。
    petLog('renderer', 'setState', { next: 'running' })
    assert.equal(lines.length, 3)

    // 超过窗口后再出现 → 落盘，×2 表示这一行代表两次。
    clock.set(2_000_000 + 6000)
    petLog('renderer', 'setState', { next: 'running' })
    assert.equal(lines.length, 4)
    assert.match(lines[3], /×2$/)
  } finally {
    restore()
    clock.restore()
  }
})

test('抑制判定按 scope + message + data 区分', () => {
  const clock = fakeClock(3_000_000)
  const { lines, restore } = captureLines()
  try {
    petLog('ui', 'applyTray', { count: 8 })
    petLog('tray', 'applyTray', { count: 8 }) // scope 不同 → 不抑制
    petLog('ui', 'applyState', { count: 8 }) // message 不同 → 不抑制
    assert.equal(lines.length, 3)
  } finally {
    restore()
    clock.restore()
  }
})

test('scope 关闭后不写日志', () => {
  const { lines, restore } = captureLines()
  try {
    setPetLogScope('muted-check', false)
    petLog('muted-check', 'should-not-appear')
    assert.equal(lines.length, 0)
    setPetLogScope('muted-check', true)
    petLog('muted-check', 'should-appear')
    assert.equal(lines.length, 1)
  } finally {
    restore()
  }
})

test('交替出现的重复行同样被压掉（状态同步的典型形态）', () => {
  const clock = fakeClock(4_000_000)
  const { lines, restore } = captureLines()
  try {
    // 一轮广播 = activity → setState → tray，逐轮交替，互不相邻。
    for (let i = 0; i < 20; i++) {
      petLog('ui', 'applyActivity', { state: 'running' })
      petLog('renderer', 'setState', { next: 'running' })
      petLog('ui', 'applyTray', { count: 1 })
    }
    assert.equal(lines.length, 3, '60 条交替日志压成 3 行')

    clock.set(4_000_000 + 5000)
    petLog('ui', 'applyActivity', { state: 'running' })
    assert.equal(lines.length, 4)
    assert.match(lines[3], /×20$/)
  } finally {
    restore()
    clock.restore()
  }
})
