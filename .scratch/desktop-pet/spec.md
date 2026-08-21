# 桌宠（Desktop Pet）重构规格

Status: ready-for-agent

## 目标

把 `plugins/pet` 从"DSH Web 浏览器悬浮宠物"重构为双部件系统：**桌宠**（Tauri 2 + Vite + 原生 TypeScript，浏览器外常驻桌面）+ **桥接插件**（DSH 薄插件），两者经 WebSocket 线协议通讯。目的：宠物在浏览器外运行，且多个 agent 工具都能接入驱动同一只宠物。

领域词汇表见 [plugins/pet/CONTEXT.md](../../plugins/pet/CONTEXT.md)。架构与协议决策见 `docs/adr/0001-desktop-pet-architecture.md`、`docs/adr/0002-pet-wire-protocol.md`。

## 已确认决策（设计树汇总）

### 两个部件

- **桌宠 (Desktop Pet)**：Tauri 2 + Vite + 原生 TS；浏览器外运行；智能服务端（状态机/多会话/宠物库/持久化/渲染）。
- **桥接插件 (Bridge Plugin)**：DSH 薄插件，只做"DSH 事件 → 线协议"翻译；沿用包名 `@yshark/dsh-codex-pet`。

### 架构

- 连接：桌宠 = WebSocket 服务端（固定默认端口 + `DSH_PET_URL` 覆盖）；桥接插件 = 客户端主动连接。
- 智能：桌宠侧。
- 浏览器 overlay：完全替换删除。
- DSH 设置页：极简入口 = 启用开关 + 连接状态 + "打开桌宠"按钮。
- 桌宠自足：只读复用 Codex 宠物库（`~/.codex/pets/`），无导入/删除；保留宠物市场入口（打开外部画廊）；设置窗 = 选择 + 缩放 + 唤醒 + 连接来源列表 + 关于。
- 常驻：独立常驻，DSH 在线变状态驱动，断开回退空闲。
- 存储：桌宠自有 app data；旧 `$DSH_HOME` 数据不迁移。
- 平台：Windows + macOS + Linux。
- DSH 默认自动连接 + 断线重连。

### 线协议（公开契约）

- WebSocket + 版本化（URL 路径 `/v1` + 握手版本号）。
- JSON Schema 为源，构建时生成 TS 类型。
- 事件集（工具 → 桌宠）：`session/status`、`session/error`（结构化 message/kind/code）、`tool/start|end`、`approval/start|end`、`question/start|end`（独立）、`subagent/start|end`（解析归父）、`session/sync`、握手快照、会话目录（含标题）。
- 每个事件带 `agent`（来源工具，开放字符串）字段；会话键 = `agent:sessionId`。
- 反向（桌宠 → 工具）：`session/open`（优雅降级）。
- 桌宠拥有"已读/就绪"语义；"当前会话"概念消失；托盘展示来源名。

### 工程

- 单仓库多包 npm workspace：`apps/desktop-pet`（桌宠）、`packages/pet-protocol`（协议）、`packages/pet-core`（纯逻辑 TS 版）、`plugins/pet`（桥接插件）。
- 新分支：`feat/tauri-desktop-pet`。
- 发布：npm `@yshark/dsh-codex-pet` 只发桥接插件；桌宠原生安装包走 GitHub Releases。
- 桌宠：双窗口（透明置顶宠物窗 + 设置窗）、Canvas 2D 渲染、托盘三项菜单（唤醒/隐藏、设置、退出）。

## 测试策略

- `packages/pet-core`：移植现有 `node:test` 套件（state-machine / pet-format / multi-session / animation / image-dims）为 TS 测试。
- `packages/pet-protocol`：JSON Schema 校验测试 + 类型生成一致性检查。
- `plugins/pet`（桥接）：mock `ctx` 集成测试，验证 DSH 事件 → 线协议事件翻译（沿用 `multi-session-host.test.js` 思路）。
- `apps/desktop-pet`：状态机接线 + 渲染的轻量冒烟。

## 范围外

- 旧 `$DSH_HOME/pets` 与 `pet-state.json` 数据迁移（Q18=C，不迁移）。
- 养成互动、`/pet` 命令、来源工具过滤子菜单（后续增强）。
