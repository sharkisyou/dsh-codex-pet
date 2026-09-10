# 宠物面：拖动只从宠物本体起拖（宠物窗的透明边距不再是热区）

状态：accepted + implemented（2026-09-10）

## 背景与问题

用户实测反馈（2026-09-10）："鼠标拖动宠物旁边白色区域，宠物也会跟着动。"

宠物窗是 345×356 的矩形（`zoom 0.9` @dpr1.25），精灵只占中间 216×234
（`measureSpriteBox()` 实机量测：offsetX 64.5 / offsetY 68 / 216×234），而 `.pet-stage`
铺满整个视口（`grid-row: 1/-1; height: 100vh`），拖动监听挂在 stage 上——于是**看不见的
透明边距也是拖动热区**。左右各约 60 / 100px、上方约 67px 的隐形热区，用户桌面是白色时
完全看不出来。

实机脚本化鼠标基线（红，部署前构建，抓取点=窗口本地物理 px，拖动 48px 后看窗口位移）：

| 抓取点 | 位移 |
|---|---|
| 精灵中心 (172,184) | 48px（正常跟手） |
| 左边距 (30,184) | **48px（缺陷）** |
| 右边距 (315,184) | **48px（缺陷）** |
| 上边距 (172,20) | **48px（缺陷）** |
| 精灵左侧外 (50,184) | **48px（缺陷）** |

不一致之处：`cursor: grab` 与右键菜单（绑精灵元素）本来就只认宠物本体，只有拖动认整窗。

## 决策（2026-09-10 用户拍板：只收窄拖动热区）

1. **起拖只认"宠物面"**：精灵 `#pet` + 待机剪影 `#pet-standby`（服务端不可达时精灵
   `visibility: hidden` 收不到事件，剪影就是当时的宠物本体）。判定用 `Element.contains`，
   以后往宠物面里加子元素（角标/装饰）自动生效，不用改判定。
2. **判定独立成模块** `src/pet-drag-surface.ts`（`isPetSurfaceTarget` + `bindPetDragStart`），
   依赖注入风格与 `drag-controller.ts` 一致 → node:test 用假 stage / 假元素即可覆盖
   "按下 → 是否起拖"，不需要 DOM 环境。
3. **待机剪影加 `pointer-events: auto`**（仅 `.pet-standby.show`）：收窄后若不放开，
   离线形态会彻底拖不动（旧行为是"整窗都能拖"顺带覆盖了它）。
4. **本次不做点击穿透**：空白区仍会被窗口吃掉点击，只是不再能拖宠物。穿透是另一条线
   （见 `.scratch/pet-clickthrough/`）。
5. **本次不做窗口 region 方案**：`SetWindowRgn` 实测可行（见文末实测记录），但用户只要
   最小改动；该实验数据留给点击穿透那条线复用。

## 关键取舍

- **用元素框，不用不透明像素 bbox**：与 `cursor: grab`、右键菜单的命中区一致，且不随动画帧
  抖动（`window-clamp` 的钳制参照物也是它）。代价：精灵自身留白（元素框内约 30px）仍可起拖。
- **只在 pointerdown 判定**：pointermove/up/cancel 仍挂在 stage 上，指针捕获也仍在 stage ——
  拖动一旦开始，光标甩出宠物面/窗口照旧跟手（23 项拖动回归套件复测全绿）。

## 实现记录

- 新增 `apps/desktop-pet/src/pet-drag-surface.ts`（判定 + 绑定 + 指针捕获）。
- `apps/desktop-pet/src/main.ts`：stage 的 `pointerdown` 内联块换成
  `bindPetDragStart(stage, standbyEl ? [petEl, standbyEl] : [petEl], drag)`。
- `apps/desktop-pet/src/style.css`：`.pet-standby.show { pointer-events: auto }`。
- 新增 `apps/desktop-pet/test/pet-drag-surface.test.ts`（6 项）。
- 顺带修既有 flake：`test/controller.test.ts` 的 `gateway sends a full state snapshot on connect`
  把固定 30ms 睡眠换成 `waitForMessage` 轮询——新增测试文件并行执行时它会因满负载翻车。

## 验证记录（2026-09-10）

- **红测**：先按"不判定、按下即起拖"实现 → 6 项里"空白区按下不起拖"失败（1 !== 0）；
  补上判定后 6/6 绿。证明测试对该缺陷敏感。
- `tsc --noEmit` 通过；desktop-pet 129 项测试全绿。
- **实机复测**（部署 `desktop-pet.exe`，md5 `215803f7…`，MinGW 交叉 + `custom-protocol`）：

  | 抓取点 | 修复前 | 修复后 |
  |---|---|---|
  | 精灵中心 (172,184) | 48px | **48px 精确** |
  | 左边距 (30,184) | 48px | **0px** |
  | 右边距 (315,184) | 48px | **0px** |
  | 上边距 (172,20) | 48px | **0px** |
  | 精灵左侧外 (50,184) | 48px | **0px** |

- **命中图**（9×9 网格扫描，每点拖 32px 看窗口是否跟动）：可拖区域收敛为精灵元素框
  （采样到 x 100–250 / y 100–270 全中，框外全不可拖）。
- **离线形态**（`systemctl --user stop pet-server` 后重启宠物，窗口回到默认 400×400、
  显示待机剪影）：剪影中心 (200,219) 拖 48px → 48px；"未连接"角标 (200,332) 拖 48px → 48px；
  左右边距对照 → 0px。
- **拖动管线 23 项回归套件**（`/tmp/petdiag/verify3.ps1`，出厂构建）：慢拖 2/2、单帧快甩 8/8、
  单帧+松手延迟 3/3、快速轻推 2/2、多报告甩动 2/2、连发立刻松手 6/6 —— **全部"精确"**。
- 部署后宠物停在 1488,381（复测脚本归位），在线 idle，`settings.json` 与窗口位置一致。

## 实测记录：窗口 region 方案（本次未采用，留给点击穿透）

`SetWindowRgn` 在 WebView2 透明窗上**确实生效**（视觉与命中一起裁），坐标是**窗口本地**：

- region = 精灵框 (64,67,216×234)：左边距探针穿透到桌面（底层 Chrome 收到），精灵中心仍命中
  自家 webview（`msedgewebview2`）；把 region 置成空集时整只宠物从屏幕上消失（说明合成被裁）。
- 边距拖动 = 0px；宠物身上拖 150px 仍**精确**（鼠标捕获不受 region 影响，甩出区域不断拖）。
- 注意：托盘角标带（窗口底部约 50px）必须并进 region，否则角标会点不到（实测被裁掉）。
- 与 spec 里的轮询方案（`set_ignore_cursor_events` + 光标轮询）相比：region 零延迟、
  无轮询线程、拖动不必钉住。
