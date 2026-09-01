#!/usr/bin/env node
/**
 * simulate-pet-states.mjs — 手动测试辅助脚本
 *
 * 以桥接协议向 pet server（ws://127.0.0.1:3720/v1）注入合成活动，让桌宠
 * 像收到真实 DSH 事件一样显示气泡与托盘。用于手动验证：
 *   - 运行中（thinking / executingTool）
 *   - 需要输入（question → 等待回答 / approval → 等待批准）
 *   - 受阻（error）
 *
 * 用法：
 *   node scripts/simulate-pet-states.mjs            # 默认 60 秒后自动断开
 *   node scripts/simulate-pet-states.mjs 120        # 保持 120 秒
 *
 * 断开后 `fake` 来源的活动会被 pet server 自动清理（断连 sync 清空）。
 */

import WebSocket from 'ws'

const URL = process.env.PET_SERVER_URL || 'ws://127.0.0.1:3720/v1'
const HOLD_MS = (Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 60) * 1000

const socket = new WebSocket(URL)

function send(event) {
  socket.send(JSON.stringify(event))
}

socket.on('open', () => {
  const events = [
    // 握手：agent=fake，协议版本 1
    { type: 'hello', agent: 'fake', protocolVersion: 1 },
    // 运行中（思考中）
    { type: 'session/status', agent: 'fake', sessionId: 'fake-thinking', status: 'running' },
    // 运行中（执行工具）
    { type: 'tool/start', agent: 'fake', sessionId: 'fake-tool', name: 'read' },
    // 提问 → 等待回答
    { type: 'question/start', agent: 'fake', sessionId: 'fake-question', prompt: '继续吗？' },
    // 审批 → 等待批准
    { type: 'approval/start', agent: 'fake', sessionId: 'fake-approval', count: 1 },
    // 错误 → 受阻
    { type: 'session/error', agent: 'fake', sessionId: 'fake-blocked', message: '模拟错误' },
  ]
  for (const event of events) send(event)
  console.log(`[simulate] 已注入 ${events.length - 1} 个合成活动（agent=fake），保持 ${HOLD_MS / 1000}s...`)
  console.log('[simulate] 去桌宠/浏览器观察：活动托盘（fake · 运行中 / 需要输入 / 受阻）')
})

socket.on('error', (error) => {
  console.error('[simulate] 连接失败（pet server 没起？）：', error.message)
  process.exit(1)
})

setTimeout(() => {
  console.log('[simulate] 断开连接，fake 活动将由 pet server 自动清理')
  socket.close()
  process.exit(0)
}, HOLD_MS)
