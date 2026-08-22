# dsh-pet-plugin

DeepSeek Harness 宠物插件仓库，实现**桌宠（Desktop Pet）双部件系统**的单仓库多包 npm workspace。

## 仓库结构

```
.
├── apps/desktop-pet/          # Tauri 2 + Vite + 原生 TypeScript 桌宠
├── packages/pet-protocol/     # 线协议：JSON Schema、常量、生成 TS 类型
├── packages/pet-core/         # 桌宠纯逻辑：state-machine / multi-session 等 TS 版
├── plugins/pet/               # DSH 桥接插件（沿用 @yshark/dsh-codex-pet）
├── docs/adr/                  # 系统级架构与协议决策
├── docs/agents/               # Agent 技能说明
└── .scratch/                  # 本地 issue 与规格
```

## 快速开始

### 根目录（monorepo）

```sh
npm install
npm run build       # 构建所有 workspace
npm test            # 跑所有 workspace 测试
npm run typecheck   # 所有 TypeScript workspace 类型检查
```

### 桥接插件（DSH → 桌宠）

```sh
cd plugins/pet
npm run build   # 语法检查插件与设置页客户端
npm test        # 运行桥接翻译、重连与设置开关测试
```

桥接插件只发布 DSH 侧翻译器与设置页极简入口；宠物渲染、宠物库和状态机都在桌宠侧。

### 桌宠（apps/desktop-pet）

```sh
cd apps/desktop-pet
npm run dev        # Vite 前端开发
npm run tauri dev  # 启动 Tauri 桌面外壳（需要 Rust 工具链）
npm test
```

## DSH 安装（桥接插件）

```sh
dsh plugin --profile web add @yshark/dsh-codex-pet
dsh web
```

安装后可在 DSH 设置页看到“桌宠”面板，用于启用/停用桥接、查看连接状态和打开桌宠。
