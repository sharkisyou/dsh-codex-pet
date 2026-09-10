# 宠物窗固定尺寸：不可拉伸 + 无手势缩放

## 背景与问题

宠物窗（`label: pet`）是 `decorations: false` + `transparent: true` + `alwaysOnTop` 的透明小窗，
尺寸由设置里的 `zoom` 算出来（`applyZoom`：宽 `max(276, 192×zoom+16)`、高 `208×zoom+16+82`）。
用户实测反馈两件事：

1. **窗口有隐形拉伸手柄**：`resizable: true` 让 Windows 给窗口带上 `WS_THICKFRAME`，无边框窗因此
   在四边留下那圈不可见的拉伸热区（实测 style `0x14CF0000`，`thickframe=True`）。宠物窗主体是
   透明边距，用户根本看不出那里能拉伸，却会误拉改尺寸；反过来在那圈热区内按下也**不会进入拖动**，
   而是被 OS 拿去做 resize —— 属于"看不见的坑"。
2. **Ctrl+滚轮会改大小**：`pet-shell` 在 document 上监听 `wheel`，`ctrlKey` 命中就改缩放
   （实测 Ctrl+滚轮 ×3：窗口 345×356 → 345×419，即 zoom 0.9→1.14）。用户不希望有这条路径，
   而且它**只改本地 zoom、不落盘**（与设置里的 `zoom` 静默分叉），更让人困惑。

## 决策（2026-09-10 用户拍板）

1. **宠物窗 `resizable: false`**（`src-tauri/tauri.conf.json`）：去掉 `WS_THICKFRAME`，既没有隐形
   拉伸手柄，窗口边缘的按下也回归到拖动管线。尺寸仍由程序控制（`setSize` 不受该标志影响，
   见验证记录）。设置窗、托盘窗的 `resizable` 各自不变（设置窗可拉伸；托盘窗本来就是 false）。
2. **移除宠物窗的全部手势缩放**（`src/pet-shell.ts`）：删掉 `wheel`（Ctrl+滚轮）与双指 pinch
   的监听与实现，连同只为它们存在的 `clampScale` / `wheelZoomDirection` / `MIN_SCALE` /
   `MAX_SCALE` / `WHEEL_SCALE_STEP`、`PetShellOptions.getScale/setScale` 一并删除
   → `test/pet-shell.test.ts` 随之删除（其两个用例只覆盖这两个已删函数）。
3. **尺寸的唯一入口 = 设置窗「缩放」滑块**（`settings.zoom` → 服务端 sanitize/clamp → 广播 →
   宠物窗 `applyZoom`）。`zoom.hint` 文案同步改写为中/英「不可拉伸、无手势缩放，只由滑块决定」。
4. **不动可嵌入网页的 widget**（`src/widget/codex-pet-widget.ts`）：它是另一个产品面（`CodexPet.mount`
   嵌入第三方页面，`dist-widget/` 不入库），其 Ctrl+滚轮/双指缩略策略保持不变。

## 实现记录

- `src-tauri/tauri.conf.json`：pet 窗口 `resizable: true → false`。
- `src/pet-shell.ts`：删 wheel/touch 监听与缩放实现、删相关导出与选项，模块注释改为
  「窗口尺寸不归本模块管」。
- `src/main.ts`：`mountPetShell({...})` 去掉 `getScale/setScale` 接线（`zoom` 仍由
  `applySettings → applyZoom → renderer.setScale + win.setSize` 驱动）。
- `src/i18n.ts`：`zoom.hint` 中英文案改写。
- 删除 `test/pet-shell.test.ts`；词汇表 `apps/desktop-pet/CONTEXT.md` 增加「宠物窗尺寸」。

## 验证记录（2026-09-10）

改前基线（运行中的旧构建，脚本化测量）：

- pet 窗口 style `0x14CF0000` → `thickframe=True`（隐形手柄存在）；Ctrl+滚轮 ×3 后窗口 345×356 →
  345×419（zoom 0.9→1.14，本地生效、`settings.json` 仍为 0.9）；纯滚轮不改变尺寸。

改后复测（部署新构建后，脚本化测量）：

| 判定项 | 改前 | 改后 |
|---|---|---|
| 宠物窗 `GWL_STYLE` | `0x14CF0000` thickframe=**True** | `0x14CB0000` thickframe=**False** |
| Ctrl+滚轮 ×3 | 345×356 → **345×419**（zoom 0.9→1.14，只改本地不落盘） | **345×356 不变**（`zoom` 仍 0.9） |
| 纯滚轮 ×3（对照） | 不变 | 不变 |
| 程序化 `setSize`（经 `/v1/ui` 推 `zoom=1.4`） | — | **356×486**（=285×389 逻辑，与公式一致）；托盘窗跟随 y 530→660 |
| 推回 `zoom=0.9` | — | **345×356**；托盘窗回到 y 530 |
| 窗口左边缘内侧 2px 按下再拖 60px | 该处是 OS 拉伸热区 | **窗口平移 60px、尺寸不变**（走进拖动管线） |
| 拖动回归：慢拖 40px / 单帧快甩 -120px | 精确 | 精确 |

结论：`resizable: false` **不影响程序化 `setSize`**（Windows 上 tao 直接 `SetWindowPos`，已实测）；
隐形拉伸手柄消失；窗口边缘的按下回归拖动管线——顺手消掉一类"看不见的拖不动"。
部署状态：exe 已替换并重启（md5 `df3b9204…`），桌宠停在 1639,170（启动硬钳制把它从
保存的 1667,170 拉回屏内 28px，属既有硬钳制行为），`settings.json` 记录 `zoom: 0.9`。

> **2026-09-10 后续修订**：上表"窗口左边缘内侧 2px 按下再拖 60px → 窗口平移 60px"这一行为
> 已被 `.scratch/pet-drag-surface/spec.md` 取代——起拖现在只认宠物面（精灵/待机剪影），
> 窗口边缘的按下**不再起拖**（也不起拉伸，仍是"无隐形手柄"）。`resizable: false` 的结论本身不变。
