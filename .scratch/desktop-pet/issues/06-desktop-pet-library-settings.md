# 06 — 桌宠：宠物库（读 Codex 目录）+ 选择 + 设置窗 + 持久化 + 宠物市场

**What to build:** 桌宠直接只读使用 Codex 宠物库：列出可选宠物、选择当前宠物，并把选择/缩放/唤醒等状态持久化到桌宠自有数据目录；提供设置窗（选择、缩放、唤醒、连接来源列表、关于）与宠物市场入口（打开外部画廊，不负责导入）。

**Blocked by:** 03 — pet-core：纯逻辑 TS 移植；05 — 桌宠：WS 服务端 + pet-core 接线 + Canvas 渲染

**Status:** resolved

- [x] 桌宠能只读列出并选择 Codex 宠物库中的宠物，不复制不删除。
- [x] 选择、缩放、唤醒状态持久化到桌宠 app data，重启后恢复。
- [x] 设置窗提供：宠物选择、缩放、唤醒、已连接来源工具列表、关于。
- [x] 宠物市场入口打开外部宠物画廊；不含导入/删除功能。

## Answer

Implemented in `apps/desktop-pet` and documented in `docs/adr/0003-desktop-pet-ui-control-plane.md`.

- `src/pet-library.ts` — 只读 Codex 宠物库（`~/.codex/pets/`，可用 `DSH_PET_LIBRARY_DIR` 覆盖）：列出有效宠物包、加载 pet.json + 图集 base64/data URL，严格校验 id 与图集路径，不导入、不复制、不删除。
- `src/settings-store.ts` — 桌宠自有 app data 持久化：`selectedPetId` / `zoom` / `awake` 写入 `<app-data>/dev.yshark.desktop-pet/settings.json`，按平台解析目录，支持 `DSH_PET_DATA_DIR` 覆盖；重启后自动恢复。
- `src/controller.ts` — 应用控制器：桥接服务器、宠物库、设置存储的粘合层；提供宠物列表/加载、设置更新/校验、来源工具与活动快照。
- `src/ui-gateway.ts` — 桌宠内部 UI 控制通道 `/v1/ui`，与公开桥接协议 `/v1` 同端口/不同路径；支持状态快照、设置更新广播、宠物加载、宠物库刷新与实时变更推送。
- `src/server.ts` — 真实模式下改为共享 HTTP server + 路径路由，支持内部 delegate 路径；注入式 fake server 保持原单路径行为。
- `src/settings-app.ts` + `src/ui-client.ts` — 设置窗 UI（宠物选择、缩放、唤醒、已连接来源工具列表、关于、宠物市场入口）与宠物窗实时接线（选中宠物渲染、缩放、唤醒显隐、活动状态/气泡）。
- 市场入口为 `https://petdex.dev/zh`，仅打开外部画廊；不含任何导入/删除能力。

Tests: `test/pet-library.test.ts`、`test/settings-store.test.ts`、`test/controller.test.ts`（28 个桌宠测试全部通过；仓库全量 typecheck/build/test 通过）。
