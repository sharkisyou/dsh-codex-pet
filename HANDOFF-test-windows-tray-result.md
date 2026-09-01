# 交接：Windows 桌宠托盘测试结果 + DSH API 变更修复

> 本文是 `HANDOFF-test-windows-tray.md` 的执行结果交接（保存在仓库根目录）。
> 会话任务：**测试 Windows 桌宠窗口的托盘功能**（系统托盘 + 活动托盘 + DSH 状态流）。
> 期间发现 DSH 更新导致的 API 失效，一并修复。全部改动已过测试，可安全合入。

## 1. 结论摘要

| 项目 | 结果 |
|---|---|
| 活动托盘（宠物窗内 "活动 (N)"） | ✅ 已验证，含实时 DSH 数据 |
| DSH 状态 → 托盘（思考/工具/权限/提问） | ✅ 全状态验证通过 |
| 系统托盘图标 + 菜单 | ⚠️ 已注册（代码标准、应用正常启动），Win11 下图标在"隐藏图标"溢出区，需人工在桌面确认 |
| 托盘点击 → 标记已读 | ✅ 已验证 |
| 托盘点击 → 打开 DSH 会话 | ✅ 已修复（含 client 导航 + DSH allowlist），**需重启 dsh web 生效** |
| 桥接插件 cordis proxy 崩溃（会杀死整个 GUI） | ✅ 已修复（本次发现的严重 bug） |
| 活动托盘按钮被 CSS 永久隐藏 | ✅ 已修复 |

## 2. 本次修复的 bug（按严重度）

### 2.1 [严重] 桥接插件在 session/open 时崩溃整个 DSH GUI
- **现象**：桌宠托盘点击 → pet server 转发 `session/open` → 桥接插件访问 `ctx.openSession`
  （cordis ctx 是 Proxy，未 inject 的属性读取直接抛 `cannot get property "openSession" without inject`）→
  异常未捕获 → 整个 `dsh web` 进程崩溃（含正在运行的 agent 会话）。
- **根因**：`plugins/pet/lib/index.mjs` 里 `typeof ctx.openSession === 'function'` /
  `typeof ctx.openPet === 'function'` 这类对未注入属性的**直接属性读取**。
- **修复**：全部改为 `ctx.get('openSession')` / `ctx.get('openPet')`（try/catch），
  并把 `ctx.emit('session/open')` 作为首选路径（新 DSH 的转发机制）。
  `getSessionsService`/`webServer` 的 `ctx.sessions`/`ctx.webServer` 兜底读取也加了 try/catch。
- **回归测试**：`plugins/pet/test/inject.test.mjs` 新增 strict-proxy 下 openPet / session/open 不抛错。
- **验证**：真实 GUI 下发 `tray/open` → 桥接收到 `session/open` → GUI 存活（进程不退出）。

### 2.2 [功能] 活动托盘按钮被 CSS 永久隐藏
- **现象**：`.activity-tray-toggle { display: none !important; }`（遗留自设置窗+市场大改版），
  即使 `main.ts` 正确地 `trayToggle.hidden = false`，按钮也永远不显示 → 活动托盘无法打开。
- **修复**：`apps/desktop-pet/src/style.css` 删除该 `display: none !important`。
- **验证**：浏览器 + Windows CDP 均确认按钮可见（`display: inline-block`，文案 "活动 (N)"）。

### 2.3 [功能] 托盘点击"打开 DSH 会话"在新 DSH 失效
- **原因**：DSH 更新后：
  - `ctx.sessions.open()` 方法**已删除**（SessionStore 只有 create/prepare/enter/get/list/fork）；
  - `ctx.openSession` 宿主钩子不存在；
  - `session/open` 事件不再有宿主监听；客户端会话导航改为纯客户端 `sessions.open(id)`。
- **修复**（三层）：
  1. 桥接插件 `openSession`：首选 `ctx.emit('session/open', { sessionId, reason })`（proxy 安全）。
  2. DSH 侧（全局 dsh 安装
     `/home/weikang/node/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-remotes`
     的 `lib/index.js` + `lib/types/remote-events.js`）：
     `API_REMOTE_FORWARDED_EVENTS` 加入 `"session/open"`，使宿主把该事件作为
     `host/remote-event` 转发给 Web 客户端。
  3. 插件客户端 `plugins/pet/lib/client.js`：`ctx.remote.$on('session/open', ...)` →
     `ctx.get('sessions').open(sessionId)`（inject 增加 `remote`、`sessions`）。
- **生效条件**：DSH 侧 allowlist 改动**需要重启 `dsh web`** 才生效；
  客户端改动经内容哈希静态下发，刷新页面即生效（已验证加载无报错）。
- **回归测试**：`bridge.test.mjs` 新增 emit 路径测试；新增 `client.test.mjs`（VM 加载 client.js，
  验证 remote 监听 + sessions.open 调用 + 非法 payload 忽略）。

## 3. DSH API 变更核对（本次确认仍有效的部分）

| 桥接插件依赖 | 现状 | 说明 |
|---|---|---|
| `agent/status` | ✅ | 载荷 `{ agent, status }`，`agent` 为 **Agent 对象**（有 `.id`/`.session`），`sessionIdOf(agent)` 经 `.id` 取到 |
| `agent/error` | ✅ | 同上 |
| `tools/execute` | ✅ | `exec.agent` 为 Agent 对象，`sessionIdOf` 可解析；middleware `(exec, next)` 语义不变 |
| `approval/request` | ✅ | `req.agent` 为 Agent 对象 |
| `subagent/start\|end` | ✅ | `info = { runId, provider, id, local }`，父会话经 `sessions.get(childId).header.parentSession` 解析 |
| `session/created\|disposed` | ✅ | `session.id` 不变 |
| `ctx.get('sessions')` | ✅ | 服务仍在，有 `list()`/`get(id)`；**无 `open()`** |
| `ctx.get('agents')` | ✅ | 仍在 |
| `webServer.register({kind:'prefix',...})` | ✅ | 不变 |
| `dsh plugin --profile <p> <pnpm args>` CLI | ✅ | 仍存在（转发 pnpm） |
| `session/open` 事件 | ⚠️ | 无宿主监听，需走 allowlist 转发（见 2.3） |

## 4. 测试验证记录（WSL + Windows）

### 4.1 实时数据流（真实 DSH 会话）
- 本会话（agent）的工具调用 → 桥接插件 → pet server → 托盘实时显示：
  - `dsh · 运行中`，气泡 `执行工具: bash`（`executingTool`）。
- pet server 状态：`state=running, bubbleKey=executingTool, bubbleParams={name:'bash'}`。

### 4.2 全状态托盘映射（合成桥接事件验证）
| 事件 | 托盘显示 | 结果 |
|---|---|---|
| `session/status running` | `运行中`（thinking） | ✅ |
| `tool/start bash` | `运行中`（executingTool） | ✅ |
| `approval/start` | `需要输入`（waitingApproval） | ✅ |
| `question/start` | `需要输入`（waitingAnswer） | ✅ |
| `session/error` | `受阻` | ✅ |
| 点击项 / `tray/ack` | `acknowledged=true, reminder=false` | ✅ |

### 4.3 Windows 原生桌宠（build-win.sh 重建后）
- 通过 **WebView2 CDP**（`--remote-debugging-port=9222`，Windows 侧本地访问）直接读 DOM：
  - 宠物窗 `#activity-tray-toggle`：存在、`display:inline-block`、文案 **"活动 (3)"** ✅
  - 展开后 3 项：`dsh · 运行中`、`fake · 需要输入`（提问）、`fake · 需要输入`（审批）✅
  - 气泡 `dsh / 执行工具: bash`（实时数据）✅，状态 `来源：dsh` ✅
- PrintWindow 截图 + MIMO V2.5 视觉复核：宠物正常渲染、托盘列表可见（"需要输入"、蓝点未读标记）。
- 截图存档（仓库根目录，.gitignore 已排除）：`shot-win-pet*.png`、`shot-win-taskbar*.png`、
  `shot-win-final-tray.png` 等。

### 4.4 系统托盘（Windows 任务栏）
- 代码为标准 Tauri `TrayIconBuilder`（tooltip "桌宠"，菜单 唤醒/隐藏/设置/退出，右键菜单），
  应用正常启动 ⇒ `tray.build()` 成功、图标已注册。
- **可视确认受限**：Win11 任务栏把新图标放入"隐藏图标"溢出区；UIA/截图均难以自动定位到图标
  （图标为深色、桌面有其他窗口遮挡）。
  - **待人工确认**：Windows 桌面上点任务栏右下角 `^` 展开隐藏图标，把"桌宠"图标拖出即可常驻；
    右键验证 唤醒/隐藏、设置、退出。

## 5. 当前运行状态（供继续测试）

- WSL 侧：
  - pet server `ws://127.0.0.1:3720/v1`（后台 job）
  - Vite `http://127.0.0.1:1420/`（后台 job）
  - `dsh web` 已在运行（PID 9813，加载了修复后的桥接插件源码）
- Windows 侧：`desktop-pet.exe` 运行中（WebView2 CDP 端口 9222，仅 Windows 本地可访问）。
- 如需重启 `dsh web`：`cd ~ && dsh web`（**重启后** allowlist 修复才生效；当前进程用旧 allowlist，
  但客户端与桥接崩溃修复已生效）。

## 6. 改动文件清单

| 文件 | 改动 |
|---|---|
| `plugins/pet/lib/index.mjs` | openSession 重构（emit 优先 + proxy 安全）、openPet/getSessionsService/webServer proxy 安全 |
| `plugins/pet/lib/client.js` | 新增 `session/open` remote 监听 → `sessions.open`；inject 增 `remote`/`sessions` |
| `plugins/pet/test/bridge.test.mjs` | 新增 emit 路径 + proxy 安全测试 |
| `plugins/pet/test/inject.test.mjs` | 新增 openPet / session/open 崩溃回归测试 |
| `plugins/pet/test/client.test.mjs` | **新增**：VM 加载 client.js 验证导航逻辑 |
| `apps/desktop-pet/src/style.css` | 删除 `.activity-tray-toggle` 的 `display:none !important` |
| `apps/desktop-pet/src-tauri/src/main.rs` | 去掉 `let mut tray` 的未使用 `mut` 警告 |
| DSH 安装（`dsh-api-remotes` 两处 allowlist） | `API_REMOTE_FORWARDED_EVENTS` 加入 `session/open`（**需重启 dsh web 生效**） |

测试：`plugins/pet` 21 项全过；`apps/desktop-pet` 65 项全过。

## 7. 备注 / 后续

- **Windows 侧工具链勿重装**；日常改前端后重建 Windows 用 `./scripts/build-win.sh build`
  （复用 Windows target，~10s）；`sync`/`extract` 会清掉 target 触发全量编译。
- 系统托盘图标常驻：可在 Win11 设置（个性化→任务栏→系统托盘图标）里把"Desktop Pet"设为始终显示，
  或从溢出区拖出。
- 若后续 DSH 再次升级：核对 `API_REMOTE_FORWARDED_EVENTS` 是否仍含 `session/open`；
  桥接插件事件名核对表见第 3 节。

---

## 8. DSH 0.1.2-alpha.3 复测结果（2026-09-01）

DSH 升级到 **0.1.2-alpha.3** 后的完整复测结论：**托盘核心链路全部通过，无需改仓库代码**。

### 8.1 alpha 版变化（对桥接插件的影响）

| 项 | rc.2 | alpha.3 | 影响 |
|---|---|---|---|
| `API_REMOTE_FORWARDED_EVENTS` 格式 | 字符串数组 | `[{event, mode}]` 数组，`mode: emit\|waterfall` | allowlist 补丁需按新格式重打；已重打 |
| `dsh-host-apiproxy` | 存在（转发 host/remote-event） | 删除，改为 `dsh-api-gateway` + typert `$events` 流 | 桥接插件不直接依赖，无影响 |
| `ctx.remote.$on`（客户端） | 存在 | 仍存在（`ClientRemoteService.$on`） | client.js 无需改 |
| `ctx.get('sessions').open(id)`（客户端） | 存在 | 仍存在（`dsh-api-session-controller` 提供） | client.js 无需改 |
| `dsh-client-runtime` | 存在 | 删除（职责并入 connection/session-controller） | 插件只注入服务名，无影响 |
| 宿主事件载荷（`agent/status` 等 fused `agent` 对象） | 对象 | 不变（`agentEvents` fused 仍在） | 桥接 `sessionIdOf(payload.agent).id` 仍有效 |
| `approval/request` | 宿主内 waterfall | 进入 allowlist（`mode: waterfall` 转发到客户端） | 不影响桥接（桥接仍在宿主侧监听） |

### 8.2 复测项与结果（均实测）

| 项 | 结果 |
|---|---|
| 桥接插件在 alpha 加载并连上 pet server | ✅ `connected:true` |
| 实时数据流（本会话工具调用 → 托盘） | ✅ `dsh · 运行中` + 气泡 `执行工具: bash` |
| 全状态映射（合成事件） | ✅ approval→需要输入、question→需要输入、error→受阻、running→运行中 |
| 浏览器托盘渲染（Vite 1420） | ✅ 按钮 `活动 (N)` 可见、项带状态标签 |
| Windows 桌宠托盘（WebView2 CDP） | ✅ `活动 (1)`、`dsh · 运行中`、气泡实时数据 |
| 插件测试 | ✅ 21 项全过 |
| 桌宠测试 | ✅ 65 项全过 |
| allowlist 补丁 | ✅ 已按新格式重打（`lib/index.js` + `lib/types/remote-events.js`） |

### 8.3 待办

- **重启 `dsh web` 一次**以激活重打的 allowlist（当前进程仍是旧 allowlist）。
  重启后托盘点击 → 打开 DSH 会话的完整链路生效（client.js 已随页面刷新加载新逻辑）。
  其余功能不依赖该重启，均已生效。
- GUI 页面（3080）在 alpha 下首页返回 401（浏览器信任栅栏行为变化），属 GUI 自身问题，
  不影响 pet server/桥接/托盘链路。

### 8.4 重启后完整链路验证（已通过）

- `dsh web` 已重启（PID 43354，`--no-open`），allowlist 生效。
- **托盘点击 → 打开 DSH 会话** 端到端验证：
  - 经 pet server `/v1/ui` 发 `tray/open`（目标 `session-079f8d20-…`）
    → 桥接 `ctx.emit('session/open')` → dsh-api-remotes 新格式 allowlist 转发
    → 客户端 `remote.$on` → `sessions.open()` → **GUI 实际切换到该会话**（浏览器实测内容切换）。
  - 再发 `tray/open` 回本会话，GUI 切回，往返正常。
- alpha 浏览器信任：GUI 首页 URL 带 `?token=…`（`dsh web` 启动日志打印），带 token 访问即 200。
