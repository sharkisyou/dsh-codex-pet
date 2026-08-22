# 07 — 桌宠：活动托盘（多会话 + agent 名 + 已读/就绪 + session/open）

**What to build:** 桌宠展示多来源活动会话的活动托盘：按全局优先级聚合展示，每项带来源工具名；用户点击标记已读并尝试通过反向请求让 DSH Web 打开对应会话（不可用时优雅降级）；收到会话同步后清理已消失会话。

**Blocked by:** 05 — 桌宠：WS 服务端 + pet-core 接线 + Canvas 渲染

**Status:** resolved

- [x] 托盘列出多个来源工具的活动会话，带来源名与状态，按优先级排序。
- [x] 点击托盘项标记该会话已读；"就绪"语义按桌宠侧已读状态工作。
- [x] 点击会发送打开会话的请求；目标不可用时优雅降级（打开 DSH 首页或无操作）。
- [x] 会话同步后，已消失会话从托盘与状态机中清理。

## Answer

Implemented in `apps/desktop-pet` and `packages/pet-core`:

- `src/controller.ts` — 暴露多来源活动托盘快照（`activities`/`tray`/`activityList`/`trayActivities`），提供 `markActivityRead`、`openSession` 与 `handleTrayClick`（标记已读 + 发送 `session/open`）。
- `src/server.ts` — 增加托盘读取（含 `reminder` 过滤）与已读标记/RPC 别名；保留完整活动列表 `activeActivities`/`allActivities` 供状态机使用。
- `src/ui-gateway.ts` + `src/ui-client.ts` — 内部 UI 控制通道新增 `activities/get`、`activity/ack`、`tray/open` 等消息，并把活动托盘随 `state`/`state-sync` 推送给宠物窗与设置窗。
- `src/main.ts` + `src/style.css` — 宠物窗新增活动托盘浮层：显示来源工具、状态、标题/会话 id，点击调用打开并标记已读。
- `packages/pet-core` — 已读的 `ready` 会话与已读的 blocked 会话一样不再作为提醒项（`reminder = false`），会话同步清理逻辑保持由共享 session store 执行。

Tests: `apps/desktop-pet/test/tray.test.ts` 覆盖多来源聚合、已读/打开、会话同步清理；桌宠全部 31 个测试通过，pet-core 27 个测试通过。
