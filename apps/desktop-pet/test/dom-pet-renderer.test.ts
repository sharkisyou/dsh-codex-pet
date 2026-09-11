import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_WAKE_MS,
  MIN_WAKE_MS,
  ROWS,
  buildFallbackStates,
  nextAnimationName,
  nextFrameDelayMs,
  resolveAnimation,
} from '../src/dom-pet-renderer'

test('builds the standard 9-row fallback atlas', () => {
  const states = buildFallbackStates()
  assert.equal(states.idle.row, 0)
  assert.equal(states['running-right'].row, 1)
  assert.equal(states['running-left'].row, 2)
  assert.equal(states.waving.row, 3)
  assert.equal(states.jumping.row, 4)
  assert.equal(states.failed.row, 5)
  assert.equal(states.waiting.row, 6)
  assert.equal(states.running.row, 7)
  assert.equal(states.review.row, 8)
  assert.equal(states.waving.playback, 'once')
  assert.equal(states.idle.playback, 'loop')
  assert.equal(ROWS, 9)
})

test('resolves display states to atlas animations', () => {
  const states = buildFallbackStates()
  assert.equal(resolveAnimation('idle', states)?.row, 0)
  assert.equal(resolveAnimation('running', states)?.row, 7)
  assert.equal(resolveAnimation('waiting', states)?.row, 6)
  assert.equal(resolveAnimation('blocked', states)?.row, 5) // → failed
  assert.equal(resolveAnimation('failed', states)?.row, 5)
  assert.equal(resolveAnimation('ready', states)?.row, 8) // → review
})

test('resolves interaction states and falls back to idle', () => {
  const states = buildFallbackStates()
  assert.equal(resolveAnimation('jumping', states)?.row, 4)
  assert.equal(resolveAnimation('waving', states)?.row, 3)
  assert.equal(resolveAnimation('running-left', states)?.row, 2)
  assert.equal(resolveAnimation('running-right', states)?.row, 1)
  // 未知状态回落 idle。
  assert.equal(resolveAnimation('unknown', states)?.row, 0)
  // atlas 里没有对应行时也回落 idle。
  const partial = { idle: states.idle }
  assert.equal(resolveAnimation('running', partial)?.row, 0)
})

test('nextAnimationName 优先轮播宠物包声明的点击技能', () => {
  const states = buildFallbackStates()
  const clickAnims = ['waving', 'jumping']
  assert.equal(nextAnimationName(null, clickAnims, states), 'waving')
  assert.equal(nextAnimationName('waving', clickAnims, states), 'jumping')
  assert.equal(nextAnimationName('jumping', clickAnims, states), 'waving') // 循环
  assert.equal(nextAnimationName('unknown', clickAnims, states), 'waving') // 未知 → 从头
})

test('nextAnimationName 未声明点击技能时轮播全部动作（点击一下播放下一个）', () => {
  const states = buildFallbackStates()
  // 9 个标准动作：idle, running-right, running-left, waving, jumping,
  // failed, waiting, running, review
  const order = Object.keys(states).filter((n) => states[n] !== undefined)
  assert.equal(order.length, 9)

  // 从 null 开始 → 第一个动作
  let next: string | null = nextAnimationName(null, [], states)
  assert.equal(next, order[0])
  // 依序轮播全部动作
  for (let i = 1; i < order.length; i++) {
    const current: string | null = next
    next = nextAnimationName(current, [], states)
    assert.equal(next, order[i], `从 ${current} 应轮到 ${order[i]}`)
  }
  // 最后一个动作后回到第一个（循环）
  const last: string | null = next
  next = nextAnimationName(last, [], states)
  assert.equal(next, order[0], `从 ${last} 应循环回 ${order[0]}`)
})

test('nextAnimationName 空状态与空声明返回 null', () => {
  assert.equal(nextAnimationName(null, [], {}), null)
  assert.equal(nextAnimationName(null, null, {}), null)
})

test('nextFrameDelayMs 按帧边界唤醒（不再每 16ms 空转）', () => {
  const anim = { frameCount: 4, timingMs: [100, 200, 300, 400], playback: 'loop' as const }
  assert.equal(nextFrameDelayMs(anim, 0), 100)
  assert.equal(nextFrameDelayMs(anim, 50), 50)
  assert.equal(nextFrameDelayMs(anim, 100), 200)
  assert.equal(nextFrameDelayMs(anim, 999), MIN_WAKE_MS) // 边界前也留最小间隔，避免忙循环
  assert.equal(nextFrameDelayMs(anim, 1000), 100) // 一个循环结束，回到首帧边界
})

test('nextFrameDelayMs：单帧与已播完的一次性动画长睡', () => {
  assert.equal(nextFrameDelayMs({ frameCount: 1 }, 0), MAX_WAKE_MS)
  const once = { frameCount: 3, timingMs: [100, 100, 100], playback: 'once' as const }
  assert.equal(nextFrameDelayMs(once, 0), 100)
  assert.equal(nextFrameDelayMs(once, 300), MAX_WAKE_MS) // render() 会切回 idle
})

test('nextFrameDelayMs：缺 timing 时用兜底帧时长 140ms', () => {
  const anim = { frameCount: 2 }
  assert.equal(nextFrameDelayMs(anim, 0), 140)
  assert.equal(nextFrameDelayMs(anim, 140), 140)
})
