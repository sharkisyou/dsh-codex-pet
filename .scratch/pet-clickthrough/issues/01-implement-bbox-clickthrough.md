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
