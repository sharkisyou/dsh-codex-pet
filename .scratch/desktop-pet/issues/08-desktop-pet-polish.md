# 08 — 桌宠：桌面体验（透明置顶窗 + 托盘菜单 + 拖拽 + 点击技能 + 缩放）

**What to build:** 把桌宠打磨成真正的桌面宠物体验：宠物窗透明、无边框、置顶且可拖拽，点击宠物播放点击技能动画；系统托盘提供唤醒/隐藏、设置、退出；缩放设置实际生效。

**Blocked by:** 06 — 桌宠：宠物库 + 选择 + 设置窗 + 持久化 + 宠物市场

**Status:** resolved

- [x] 宠物窗透明、无边框、置顶，可拖拽，位置记忆。
- [x] 点击宠物按包声明的顺序循环播放点击技能动画。
- [x] 系统托盘三项菜单可用：唤醒/隐藏、设置、退出。
- [x] 缩放设置生效并持久化。

## Answer

Implemented in `apps/desktop-pet`:

- `src-tauri/tauri.conf.json` keeps the pet window transparent, frameless and always-on-top; `src-tauri/src/main.rs` adds a native tray with 唤醒/隐藏、设置、退出 menu items.
- `src/main.ts` adds pointer-based dragging, saved/restored pet-window position (`windowX`/`windowY` persisted through the existing settings store), and click-to-play click-skill animation cycling.
- `src/renderer.ts` adds click-skill playback support (`playAnimation`, `playNextClickSkill`, aliases) keyed to the pet package's declared `clickAnimations` order, returning to the normal state animation after one-shot skills finish.
- `src/settings-store.ts` and `src/ui-gateway.ts` persist and forward pet-window position settings; zoom continues to be applied through `applyZoom()` and persisted by the existing settings store.
- Added tests for click-skill cycling, position persistence/sanitization, and gateway position updates.
