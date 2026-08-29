# 桌宠 UI 控制通道、宠物库与设置持久化

状态：accepted

## 背景

桌宠是双窗口应用：透明置顶宠物窗 + 普通设置窗。窗口是 Tauri webview，而智能服务端（WebSocket 服务端、宠物库读取、设置存储）运行在 Node 侧。需要一条仅属于桌宠自身的内部通道，让两个 webview 能列出 Codex 宠物库、读写设置、观察已连接来源工具。

## 决策

### 只读宠物库

桌宠直接读取 Codex 宠物库 `~/.codex/pets/`，以目录为单位列出有效宠物包（`pet.json` + 图集），并加载所选宠物的元数据与图集 base64 供 Canvas 使用。

- 只读实现：`apps/desktop-pet/src/pet-library.ts` 只调用 `readdir/readFile/stat`。
- 不复制、不导入、不删除；宠物安装仍由 Codex/宠物市场完成。
- 支持 `DSH_PET_LIBRARY_DIR` 覆盖路径，便于测试与高级用户。

### 设置持久化

桌宠自有偏好写入 Tauri/应用标准 app data 目录：

- 目录名：`dev.yshark.desktop-pet`
- 文件：`settings.json`
- 字段：`selectedPetId`、`zoom`、`awake`
- 平台解析：Windows `%APPDATA%`、macOS `~/Library/Application Support`、Linux `$XDG_DATA_HOME` 或 `~/.local/share`；支持 `DSH_PET_DATA_DIR` 覆盖。
- 不迁移旧 `$DSH_HOME` 数据。

### 内部 UI 控制通道

桌宠在同一个 WebSocket 端口上提供私有控制路径 `/v1/ui`，与公开桥接协议 `/v1` 分离：

- 同一个 HTTP server 承载，通过 upgrade path 路由到桥接处理器或 UI 网关。
- 消息集（仅桌宠内部，不是公开线协议）：
  - `state` / `state/get`：完整快照（设置、宠物列表、来源工具、活动、市场入口、版本）。
  - `settings/update` + `settings`：修改并广播设置。
  - `pet/get` + `pet`：按 id 加载宠物包（元数据 + 图集 data URL）。
  - `library/reload` + `pets`：重新扫描 Codex 宠物库。
  - `state-sync`：设置/来源工具/活动变更推送。
- 不进入 `packages/pet-protocol`，也不改变公开线协议。

### 宠物市场

设置窗提供外部画廊入口 `https://petdex.dev/zh`。桌宠不负责导入/删除，仅打开入口并在 UI 中注明“安装仍由 Codex 完成”。

> 已扩展：本决策被 [0004-online-pet-market.md](./0004-online-pet-market.md) 取代/扩展——桌宠现已内置在线市场（后端驱动的浏览/安装/缩略图）。

## 影响

- `apps/desktop-pet/src/server.ts` 真实模式改为共享 HTTP server + path 路由；注入式 fake server 保持原单路径行为。
- 新增 Node 侧模块：`pet-library.ts`、`settings-store.ts`、`controller.ts`、`ui-gateway.ts`。
- 新增浏览器侧模块：`ui-client.ts`、`settings-app.ts`。
- 设置窗 UI 与宠物窗在 webview 内通过 WS 与 Node 侧通信，后续托盘菜单（issue 08）直接复用同一控制器/网关。
