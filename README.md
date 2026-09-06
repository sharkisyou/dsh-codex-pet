# dsh-pet-plugin

DeepSeek Harness 宠物插件仓库，实现**桌宠（Desktop Pet）双部件系统**的单仓库多包 npm workspace：桌宠应用常驻桌面、通过动画反映会话状态；桥接插件把 DSH 会话活动转发给桌宠。

## 功能

- **状态驱动宠物**：宠物动画绑定会话状态（空闲/工作/等待/受阻/完成…），多会话聚合，同一时刻只展示优先级最高的会话。
- **活动托盘**：列出有活动的会话、按状态着色，点击切换到对应会话。
- **在线宠物市场**：浏览/搜索/安装/卸载 petdex 宠物包（缩略图懒加载与预取、宠物详情弹窗）；网络与文件操作全部由服务端完成，安装原子写入 `~/.codex/pets/`。
- **设置窗**：7 套外观主题 + 界面语言（系统默认/中文/English），均持久化。

## 仓库结构

```
.
├── apps/desktop-pet/          # Tauri 2 + Vite + 原生 TypeScript 桌宠（宠物窗/托盘窗/设置窗/市场）
├── packages/pet-protocol/     # 线协议：JSON Schema、常量、生成 TS 类型
├── packages/pet-core/         # 桌宠纯逻辑：state-machine / multi-session 等 TS 版
├── plugins/pet/               # DSH 桥接插件（发布为 @yshark/dsh-codex-pet）
├── tools/intro-video/         # Remotion 介绍视频工程
├── scripts/                   # build-win.sh（Windows 构建）、simulate-pet-states.mjs
├── docs/adr/                  # 系统级架构与协议决策
├── docs/agents/               # Agent 技能说明
└── .scratch/                  # 本地 issue 与规格
```

域术语与上下文见 [CONTEXT-MAP.md](CONTEXT-MAP.md)（指向各插件 `CONTEXT.md`），决策记录在 `docs/adr/`。

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
npm run dev        # Vite 前端开发（浏览器预览）
npm run server     # pet server（127.0.0.1:3720），桥接插件与前端的数据源
npm run tauri dev  # 启动 Tauri 桌面外壳（Windows 下见下方构建说明）
npm test
```

## Windows 构建（WSL → Windows）

> 实测：WSL 交叉编译到 MSVC target 不可行（缺 link.exe）；MinGW 交叉编译可行（备选路）。日常主力是 WSL 通过 interop 调用 Windows 原生 Rust 工具链，已封装为 `scripts/build-win.sh`。前置条件与完整注意事项（图标、增量编译、localhost relay、调试捕获、MinGW 配方）见 [AGENTS.md](AGENTS.md)。

```sh
./scripts/build-win.sh all           # 全流程 debug：sync→extract→deps→build→run（日常改代码用）
./scripts/build-win.sh release       # 全流程 release：无终端窗口的正式形态
./scripts/build-win.sh build         # 只构建前端 + 编译 debug exe（增量复用已有 target）
./scripts/build-win.sh build-release # 只出 release exe（增量复用 target/release）
./scripts/build-win.sh run           # 启动 debug 版桌宠（有控制台日志，排障用）
./scripts/build-win.sh run-release   # 启动 release 版桌宠
```

- 全量编译约 2 分钟，增量约 7 秒；release 首次 2-3 分钟。
- 数据源：桌宠通过 WSL2 localhost relay 连 WSL 里的 Vite（1420）与 pet server（3720），两者需保持运行，否则窗口空白。

## DSH 安装（桥接插件）

```sh
dsh plugin --profile web add @yshark/dsh-codex-pet
dsh web
```

安装后可在 DSH 设置页看到“桌宠”面板，用于启用/停用桥接、查看连接状态和打开桌宠。
