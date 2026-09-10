# 桌宠窗口拖动管线（手动 setPosition + 缓存锚点）

状态：accepted（扩展 ADR 0001「桌宠-桥接架构」的宠物窗交互面，细化 `.scratch/pet-window-clamp/spec.md` 的软钳制接入点）

## 背景

宠物窗透明置顶、无标题栏。拖动最初走 Tauri 的 `startDragging()`（原生标题栏拖动循环），
2026-09-07 实测会触发 Aero Shake（快速来回甩动宠物 → Windows 最小化其他所有窗口）与边缘
贴靠/顶部最大化，因此改为**前端按帧 `setPosition`** 手动拖动。

该实现随后暴露用户可感的"有的时候移动不了桌面宠物"。2026-09-10 用脚本化鼠标驱动实机桌宠
（DPI-aware `SetCursorPos`+`mouse_event`，轮询窗口矩形取真值）定位到三处时间竞态：

1. **起拖锚点现查 IPC**：`pointerdown` 现查 `outerPosition()` + 显示器枚举才设锚点（实测中位
   28ms、长尾 119ms），该窗口内的 `pointermove` 被丢弃，而"开始拖动"只能由锚点就绪后到达的
   `pointermove` 置位 → 单帧快甩 4/4 次零位移，手势整段失效。
2. **松手丢尾帧**：`pointermove` 只排一个 rAF，`pointerup` 不补帧就清状态 → 最后一次移动的
   位移被丢掉（实测 160px 甩动固定丢 40px、36px 轻推固定丢 6px）。
3. **锚点串台**：迟到的异步锚点未校验"按下序号"，可能被套用到下一次按下（低概率）。

同期实测排除"与 pet server 连接有关"：拖动路径不经过 WS；停掉 pet-server 后拖动行为与在线
完全一致；服务端广播负载 0 → 4 条/2s 时拖动中位帧间隔均为 17ms。

## 决策

1. **仍是前端按帧手动拖动**（不用 `startDragging()`，理由见背景），但锚点改为**宿主缓存**：
   窗口外框坐标由 `onMoved` 维护（启动预取一次），显示器矩形启动取一次 + 每次拖动后刷新；
   `pointerdown` 同步取锚点，缓存未命中才回退异步查询，且回退期间照常判定阈值并记录最新
   光标，锚点一到立即起拖补帧。
2. **松手/取消先同步补最后一帧再清状态**，残留 rAF 回调空转；`pointerUp(event)` 另以**松手坐标**兜底最后一段位移（浏览器输入合并会把整段位移并进 up 事件）。
3. **锚点带按下序号**；异步结果另用于"首个应用帧之前"校正陈旧缓存（迟到即忽略，不造成拖动中跳变）。
4. **状态机独立成模块** `apps/desktop-pet/src/drag-controller.ts`，全部依赖注入 → 可用假窗口 +
   手动帧泵在 node:test 覆盖竞态。
5. **拖动埋点**：scope `drag` 的 `start`/`end`/`anchor-*`；软钳制沿用 scope `clamp` 行格式。
6. **起拖收窄到"宠物面"**（2026-09-10 追加，用户实测"拖宠物旁边的空白区，宠物也跟着动"）：
   只有落在精灵 `#pet` 或待机剪影 `#pet-standby` 上的左键按下才交给状态机，判定与指针捕获在
   `src/pet-drag-surface.ts`。窗口四周的透明边距（345×356 的窗 vs 216×234 的精灵）在 DOM 里
   同样命中 `.pet-stage`，不判定等于整窗都是热区，且与 `cursor: grab`、右键菜单的命中区不符。
   细节与实机数据见 `.scratch/pet-drag-surface/spec.md`。

## 关键取舍

- **缓存锚点**牺牲"锚点绝对新鲜"（差一个 `onMoved` 往返）换起拖零等待；拖动中的移动由本
  管线自己产生，故缓存不会累积偏差，且首帧前的异步校正兜住极端情形。
- **同步补帧**牺牲"每帧最多一次 setPosition"的纯粹性，换"松手即停在光标处"。
- **不改 Rust、不做点击穿透**（后者见 `.scratch/pet-clickthrough/`，wontfix）。
- `applyZoom` 目前每次状态广播都 `setSize`（无谓 IPC），实测未影响帧率，留作后续优化。

## 实现记录

- 新增 `src/drag-controller.ts`；`src/main.ts` 拖动块改为接线；新增 `test/drag-controller.test.ts`（13 项）。
- 词汇表：`apps/desktop-pet/CONTEXT.md`「拖动锚点 (Drag Anchor)」。
- 验证：`tsc --noEmit` 通过；desktop-pet 113 项测试全绿；红测（去掉补帧 → 8/13 失败、
  忽略缓存 → 9/13 失败）证明测试对该缺陷敏感；实机（Windows 桌宠 + 脚本化鼠标）修复前
  单帧快甩 4/4 零位移、修复后出厂构建 23 项用例全中。复测细节见
  `.scratch/pet-drag-pipeline/spec.md`。
- 追加（2026-09-10）：新增 `src/pet-drag-surface.ts` + `test/pet-drag-surface.test.ts`（6 项），
  `style.css` 放开 `.pet-standby.show` 的事件（离线剪影要能拖）；实机复测空白区四类抓取点
  0px、宠物本体 48px 跟手、离线剪影/角标可拖、23 项拖动回归全绿。
