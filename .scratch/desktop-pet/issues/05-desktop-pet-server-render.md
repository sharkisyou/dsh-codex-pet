# 05 — 桌宠：WS 服务端 + pet-core 接线 + Canvas 渲染（端到端首条）

**What to build:** 桌宠启动 WebSocket 服务端（带版本路径），接受桥接插件连接，处理握手与快照，把收到的线协议事件喂给共享核心的状态机，并用 Canvas 2D 渲染宠物随状态播放动画与状态气泡。此票完成时，从"DSH 运行一个会话"到"桌面宠物播放工作动画"的端到端链路首次打通。

**Blocked by:** 02 — pet-protocol：线协议包；03 — pet-core：纯逻辑 TS 移植；04 — 桥接插件：WS 客户端 + 事件翻译 + 重连

**Status:** resolved

- [x] 桌宠在固定默认端口启动带版本的服务端，接受桥接连接并完成握手/快照。
- [x] 收到的会话事件驱动宠物状态机，状态变化正确反映到动画与气泡。
- [x] Canvas 2D 按宠物包帧数据渲染，工作/空闲/等待/失败等状态可区分。
- [x] 桥接离线时桌宠回退空闲；重连后经快照恢复。

## Answer

Implemented in `apps/desktop-pet`:

- `src/server.ts` — versioned WebSocket server (`/v1`, default port 3720), handshake echo, protocol validation, snapshot restore, session-store wiring, offline fallback, `session/open` forwarding.
- `src/renderer.ts` — Canvas 2D renderer using pet-core animation frame selection and state-to-animation mapping.
- `src/server-entry.ts` — standalone Node entry for real bridge connections during development.
- `packages/pet-core` — snapshot apply/export support added to the session store so reconnects can restore aggregate state.
- Tests and package wiring for the desktop app workspace.
