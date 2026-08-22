# @yshark/dsh-codex-pet（DSH 桥接插件）

DSH 桌宠系统的**桥接插件**：作为 WebSocket 客户端连接桌宠服务端，把 DSH 会话活动
翻译成桌宠线协议事件推送过去；插件本身不再渲染宠物、不再管理宠物库，只在 DSH 设置页
提供一个极简桌宠面板（启用开关、连接状态、打开桌宠按钮）。

## 功能

- WebSocket 客户端连接桌宠，默认 `ws://127.0.0.1:3720/v1`，可用 `DSH_PET_URL` 覆盖。
- 连接失败自动重试，断线后自动重连；重连成功后重新发送握手与当前会话快照。
- DSH 事件 → 线协议事件翻译：
  - `agent/status` → `session/status`
  - `agent/error` → `session/error`
  - `tools/execute` → `tool/start` / `tool/end`
  - `ask_user_question` → 独立 `question/start` / `question/end`
  - `approval/request` → `approval/start` / `approval/end`（并发计数，归零才发 end）
  - `subagent/start|end` → 解析到父会话后发送
  - 会话目录 / 会话同步 / 握手快照
- 所有事件携带来源工具名 `agent: 'dsh'` 与 `sessionId`，桌宠侧按 `(agent, sessionId)` 复合键区分。
- 处理桌宠反向 `session/open`，按可用宿主 API 优雅降级。
- DSH 设置页极简面板：
  - 启用/停用桥接（停用会立即断开，启用后自动连接）
  - 连接状态（已连接 / 连接中 / 未连接 / 已停用）
  - “打开桌宠”按钮（触发宿主打开或手动提示）

## 浏览器客户端

- `lib/client.js` 只注册 `settings.section`，不包含宠物 overlay、宠物库 UI 或渲染代码。
- 通过 `package.json` 的 `dsh.client` 声明由 DSH Web 客户端模块系统加载。

## 开发

```sh
cd plugins/pet
npm run build
npm test
```

宠物状态机、渲染、宠物库与设置持久化都在桌宠侧（`apps/desktop-pet` / `packages/pet-core`）。

打包与发布说明见 [PUBLISHING.md](./PUBLISHING.md)。
