# 宠物多会话架构（已废弃/迁移）

状态：superseded

本文件描述旧版 DSH Web 浏览器 overlay 的宿主/客户端多会话架构。桌宠双部件重构后，
多会话聚合与 Blocked 已确认语义由桌宠侧 `packages/pet-core` 实现；
桥接插件只负责把 DSH 事件翻译成线协议，不再维护状态机或 RPC。

当前架构见：

- `docs/adr/0001-desktop-pet-architecture.md`
- `docs/adr/0002-pet-wire-protocol.md`
