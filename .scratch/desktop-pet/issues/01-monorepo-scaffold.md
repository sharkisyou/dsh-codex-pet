# 01 — 单仓库脚手架与分支

**What to build:** 建立可构建、可测试的单仓库骨架：在 `feat/tauri-desktop-pet` 分支上搭好 npm workspace，让桌宠（Tauri 2 + Vite + 原生 TypeScript）、协议包、核心逻辑包三个新位置能各自构建与跑测试，同时现有 DSH 插件保持可用、不被破坏。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 新分支已创建，npm workspace 根配置就绪；`apps/desktop-pet`、`packages/pet-protocol`、`packages/pet-core` 三个位置可独立构建。
- [x] 桌宠有 Tauri 2 + Vite + 原生 TypeScript 的最小可启动骨架，含宠物窗与设置窗两个窗口的占位。
- [x] TypeScript 构建与测试工具链跑通（冒烟测试通过）。
- [x] 现有 DSH 插件仍可构建与测试（迁移期不破坏现状）。
