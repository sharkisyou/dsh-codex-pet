# 实现宠物透明区域点击穿透（包围盒方案）

Type: task
Status: ready-for-agent
Spec: ../spec.md

## 问题

桌宠窗口命中测试是矩形级的：`.pet-stage` 占满整个视口，点击宠物周围透明区域时事件被
webview 消费，不会穿透到底下的桌面图标。用户期望透明区域点击穿透、精灵本体保持交互。

## 任务

按 `../spec.md` 的设计实现包围盒方案的点击穿透：

1. TS：精灵加载/帧变化/zoom 变化时计算 bbox（含托盘角标矩形的并集），经
   `invoke('set_pet_hitbox', ...)` 推送物理坐标
2. Rust：`set_pet_hitbox` / `set_pet_dragging` 两个 command + 50-100ms 轮询光标，
   动态 `set_ignore_cursor_events`；拖拽期间钉住不穿透
3. 覆盖 spec.md 验收标准 1-6

## 注意

- 穿透状态下窗口收不到鼠标事件，切回必须靠 Rust 轮询，不能靠前端事件
- 拖拽钉住是关键坑（见 spec.md 设计要点 3），漏掉会导致快速拖动中断
- 托盘角标在透明区，hitbox 不含它则角标点击失效（见设计要点 4）

## Comments

**2026-09-10（做 `.scratch/pet-drag-surface/` 时的实机实验，建议改路线）**

上面的设计要点 2（Rust 轮询 `GetCursorPos` + `set_ignore_cursor_events`）不是必须的：
`SetWindowRgn` 把窗口形状直接裁成 hitbox 并集，**Windows 自己在 OS 层做命中测试**，
在 WebView2 透明窗上实测有效（同机同版本）：

- region 用**窗口本地**坐标；region = 精灵框时，边距探针的 `WindowFromPoint` 落到桌面窗口，
  精灵中心仍命中自家 `msedgewebview2`；region 置空时整只宠物从屏幕上消失（视觉也被裁）。
- 边距按下拖动 → 窗口 0px；宠物身上拖 150px 仍精确跟手 → **鼠标捕获不受 region 影响**，
  不需要"拖拽钉住"，也不需要轮询线程。
- 代价：region 之外的一切（含右键菜单弹出区、托盘角标带）必须并进并集，否则会被裁掉不可点。

即：**能省掉轮询延迟**（现在的轮询方案有 50–100ms 固有延迟，光标刚进精灵的第一下点击会漏给
桌面）与整套钉住/状态同步；换来的是"region 集合必须覆盖宠物窗内所有可交互 UI"这条维护约束
（建议用一个白名单模块从 DOM 收集矩形，配单测）。Linux 侧没有等价 API（`SetWindowRgn` 是 Win32），
需要保留轮询分支或用 X11 shape。详见 `.scratch/pet-drag-surface/spec.md` 末节。

