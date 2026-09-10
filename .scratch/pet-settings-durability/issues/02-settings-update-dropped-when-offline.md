# 断线时设置更新被静默丢弃（位置存档丢失）

Type: task
Status: resolved

## 现象

设置类消息（`settings/update`：窗口位置、zoom、主题、语言、选宠…）经 WS 发给 pet server 落盘。
`ui-client.send()` 在 socket 非 OPEN 时直接 `return false`，而调用方 `updateSettings` 忽略返回值
→ **patch 无声消失**：不排队、不重试、不记日志。表现：

- 断线期间拖动宠物：位置不落盘，重启后回到旧位置；
- 断线期间在设置窗改主题/语言/缩放：界面当场变，下一次快照同步又变回去，且没有任何日志解释；
- 两端都不记录连接状态变化（桌宠侧 `onStatus` 只 `console.warn`，不进 `dsh-pet.log`），
  事后无法判断"连接到底抖没抖、什么时候抖的"。

与 [`01-settings-reset-on-corrupt-load.md`](./01-settings-reset-on-corrupt-load.md) 是同一块的两个
不同失效模式：那条是"读坏档回默认值后被覆盖"，这条是"写被丢弃"。

## 决策（2026-09-10，三层一起做）

1. **可见**：`send` 失败时 `petLog('ui','send-dropped',{kind,readyState})`；`socket.send()` 抛错
   另记 `send-failed`。
2. **补发**：`ui-client` 留一个"最后一笔待发设置补丁"槽（**按 key 的 last-write-wins**）。重连时
   先 `state/get`，**等快照到达之后**再补发——顺序反了会被服务端旧快照覆盖回去（gateway 对同一条
   连接上的消息是并发处理的，快照可能晚于补丁广播到达）。补发成功才清槽；在线送达时用
   "槽 ∪ 新 patch" 的合并结果发送，避免旧槽里没送到的 key 被新 patch 的送达顺手清掉。
   2s 等不到快照则超时补发（记 `snapshot-timeout`）。一次性命令（`session/open`、`market/*` 等）
   不进槽——延迟补发它们没有意义。
3. **本地兜底**：宠物窗把位置另存一份 `localStorage`（`src/pet-position-cache.ts`，纯函数 + 注入
   `StorageLike`）：启动时**先用本地值定位**（服务端没起来时首帧同步永远不来，只有这份能让宠物
   回到上次位置），随后 `applySettings` 仍按"本地优先"做一次硬钳制（幂等），并在本地与服务端不
   一致时**回推**本地值一次（走 WS，断线中同样进上面的槽）。

## 实现记录

- `src/ui-client.ts`：`send-dropped`/`send-failed` 日志、`pendingSettingsPatch` 槽与
  `flushPendingSettings`/`markSnapshotArrived`、超时兜底。
- `src/pet-position-cache.ts`（新）+ `test/pet-position-cache.test.ts`（5 项）。
- `src/main.ts`：`saveWindowPosition` 同时写 localStorage；`applyRestorePosition(pos, source)` 抽出
  （早启动的本地定位与 `applySettings` 的恢复共用）；本地优先恢复；不一致时回推一次。
- `test/ui-client.test.ts`（新，7 项，假 `WebSocket`/假 `window` 驱动）。
- 文档：ADR 0003「设置持久化」补断线韧性一段；`apps/desktop-pet/CONTEXT.md` 增词条「位置存档」。

## 验证记录

单元测试：desktop-pet 全套 **123 项通过**（含新增 12 项）。

实机断线端到端（Windows 桌宠 + 脚本化鼠标 + `systemctl --user stop/start pet-server`）：

| 步骤 | 期望 | 实测 |
|---|---|---|
| 停服务 → 拖 (+200,−200) | 窗口跟手；`send-dropped` 入库；`settings.json` 不动 | (166,555)→(132,689)；`[ui] send-dropped {"kind":"settings/update","readyState":null}`；文件仍为旧值 ✓ |
| 起服务 | 重连拉到快照后补发 | `[ui] settings-replayed {"reason":"snapshot","patch":{"windowX":132,"windowY":689}}` ✓ |
| 再停服务 → 拖 (+180,−120) → **服务端仍关着重启桌宠** | 回到断线时拖到的位置 | 窗口出现在 (346,435)；`[ui] restore-local` + `[clamp] restore {"source":"local",…}` ✓ |
| 起服务 | 回推本地值让服务端收敛 | `[ui] position-reconciled {"local":{346,435},"server":{166,555}}`；`settings.json` → (346,435) ✓ |

## Comments

- 验证时发现第 3 步的 `[clamp] restore` 里 box 是 **zoom=1.2 的旧布局**（(240,260)）——
  服务端没起来时设置同步也来不了，窗口还是启动默认 zoom；位置恢复后再同步 zoom 会再走一次
  恢复（幂等），实机日志确认第二次用的是 0.9 的 box ✓ 属预期。
- 位置以外的设置（主题/语言/zoom）只享受第 1、2 层；要做"离线也能改"得再给它们各写一份本地
  兜底，目前没做（主题/语言在设置窗里有本地 `data-theme`，重启仍需服务端）。
