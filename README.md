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
├── scripts/                   # simulate-pet-states.mjs 等辅助脚本
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

pet server 与桥接插件的关键事件日志均落盘 `~/.dsh/logs/`（`pet-server.log` / `pet-bridge.log`，2MB 自动轮转），排障可对照查看全链路时间线；`PET_SERVER_LOG` / `DSH_PET_LOG` 可指定路径或设 `0` 关闭。

## Windows 构建（WSL → Windows）

> 日常主力：WSL 内 MinGW 交叉编译（自包含构建，无终端窗口的正式形态）。MSVC target 不可行（缺 link.exe）；安装器打包（NSIS/WiX）出现需求时走 CI（windows-latest）。前置条件、数据源、调试捕获与完整配方见 [AGENTS.md](AGENTS.md)。

```sh
cd apps/desktop-pet
npx vite build                                # ① 前端 → dist（改前端后必须重跑）
cd src-tauri
cargo build --release --target x86_64-pc-windows-gnu \
  --features tauri/custom-protocol -j 8       # ② 自包含 release exe
cp target/x86_64-pc-windows-gnu/release/{desktop-pet.exe,WebView2Loader.dll} \
   /mnt/c/Users/<user>/desktop-pet/           # ③ exe+dll 成对部署到同一目录
```

- 全量编译约 20-30 秒（增量更快）；**必须带 `--features tauri/custom-protocol`**，否则 release 也走 devUrl、窗口空白。
- 数据源：桌宠通过 WSL2 localhost relay 连 WSL 里的 pet server（3720），需保持运行，否则桌宠显示待机剪影形态。

## Linux 桌面（基本形态）

> 支持真 Linux 桌面（X11 + 合成器）；WSLg 受远程合成限制不作为目标环境。平台差异与前置库见 [AGENTS.md](AGENTS.md)。

```sh
cd apps/desktop-pet
npm run build                    # 重建前端 dist（release 会嵌入二进制）
cd src-tauri && cargo build --release
cd .. && npm run server          # 另开终端：pet server（数据源）
./src-tauri/target/release/desktop-pet
```

前置系统库（Ubuntu）：`libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`。

## DSH 安装（桥接插件）

```sh
dsh plugin --profile web add @yshark/dsh-codex-pet
dsh web
```

安装后可在 DSH 设置页看到“桌宠”面板，用于启用/停用桥接、查看连接状态和打开桌宠。
