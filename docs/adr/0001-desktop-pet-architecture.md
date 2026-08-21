# 桌宠-桥接架构

状态：accepted

## 背景

原 `plugins/pet` 是 DSH Web 界面里的浏览器悬浮宠物：宿主半（Cordis 插件）在 DSH 进程内维护状态机并通过 `/pet` HTTP RPC 供浏览器 overlay 轮询。目标是把宠物搬到**浏览器外**常驻桌面，并让**多个 agent 工具**（DSH、Codex、Claude 等）都能驱动同一只宠物。

## 决策

把系统拆成两个部件：

1. **桌宠 (Desktop Pet)** —— Tauri 2 + Vite + 原生 TypeScript 的桌面应用，浏览器外运行。
   - 它是**智能服务端**：拥有状态机、多会话聚合、宠物库、持久化与渲染。
   - 作为 WebSocket 服务端监听固定默认端口（可用 `DSH_PET_URL` 覆盖），接收各 agent 工具推送的活动。
   - 独立常驻：DSH 在线时变状态驱动，断开回退空闲。
   - 自足：只读复用 Codex 宠物库（`~/.codex/pets/`），不做导入/删除；保留宠物市场入口（打开外部画廊，安装仍由 Codex 完成）。
   - 双窗口：透明置顶宠物窗 + 普通设置窗；Canvas 2D 渲染；系统托盘（唤醒/隐藏、设置、退出）。
   - 数据存 Tauri 标准 app data；不迁移旧 `$DSH_HOME` 数据。
2. **桥接插件 (Bridge Plugin)** —— DSH 里的薄插件（沿用 `@yshark/dsh-codex-pet`）。
   - 作为 WebSocket 客户端，默认自动连接桌宠并断线重连。
   - 把 DSH 事件翻译成线协议事件推送过去（含 `question/*` 拆分、审批计数、子代理归父解析、会话目录）。
   - 不再管理宠物库、不再渲染宠物；只在 DSH 设置页保留极简入口（启用开关 + 连接状态 + 打开桌宠按钮）。
   - 完全替换并删除原浏览器 overlay。

## 关键取舍

- **智能放桌宠侧而非 DSH**：多工具接入要求"多会话优先级/聚合"只有一份真相；若各工具各自算状态会互相冲突。DSH 侧因此从 983 行瘦成一个薄翻译器。
- **桌宠做服务端、桥接做客户端**：方便任意 agent 工具实现自己的桥接接入桌宠，DSH 无需知道桌宠何时在哪。
- **直接复用 Codex 宠物库**：桌宠与 Codex 生态共享数据，省去导入/复制/同步；代价是旧 DSH 导入库（`$DSH_HOME/pets`）不再被读取，且不迁移。
- **浏览器概念消失**：无"当前会话"跟随（桌宠全局按优先级展示），"已读/就绪"语义移入桌宠。

## 影响

- 本 ADR 取代 `plugins/pet/docs/adr/0001-pet-multi-session-architecture.md` 中"浏览器 overlay + 当前会话"相关部分；多会话优先级与 Blocked 已确认语义保留，但改为按 `(agent, session)` 复合键在桌宠侧实现。
- 仓库改为单仓库多包 npm workspace：`apps/desktop-pet`、`packages/pet-protocol`、`packages/pet-core`、`plugins/pet`。
- 分发：npm `@yshark/dsh-codex-pet` 只发布桥接插件；桌宠原生安装包经 GitHub Releases 分发。
- 线协议细节见 `docs/adr/0002-pet-wire-protocol.md`。
