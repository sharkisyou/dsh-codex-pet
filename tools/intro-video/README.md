# tools/intro-video — 桌宠介绍视频（Remotion）

用 [Remotion](https://www.remotion.dev) 生成的 30 秒中英双语桌宠介绍视频 Demo。
视频里的宠物动画直接驱动真实宠物包（`~/.codex/pets/dimo-4`）的 sprite 图集，
与桌宠应用的 DOM 渲染器使用同一套 atlas 规格（8 列 × 9 行，单元格 192×208）。

## 场景结构（30s @ 30fps = 900 帧）

| 场景 | 时间 | 内容 |
| --- | --- | --- |
| 片头 | 0–6s | 桌宠 / Desktop Pet + Dimo 待机 |
| 状态动画 | 6–15s | 空闲/思考/工作/失败/就绪 五种状态动画 + 气泡 |
| 多会话追踪 | 15–22s | 活动托盘 + 宠物跟随最高优先级会话 |
| 宠物市场 | 22–28s | 10 只宠物网格 + 4600+ 在线 + 一键安装演示 |
| 片尾 | 28–30s | dsh-pet-plugin 开源署名 |

## 常用命令

```sh
npm install          # 安装依赖（remotion 4 + react 18）
npm run dev          # Remotion Studio 预览/调试
npm run render       # 渲染 out/intro-demo.mp4（需 Chromium）
npm run still        # 渲染单帧静帧 out/preview.png
```

本机没有系统 Chrome，渲染时用 Playwright 缓存的 Chromium：

```sh
npx remotion render src/index.ts IntroVideo out/intro-demo.mp4 \
  --browser-executable=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
```

## 结构

```
src/
├── index.ts              # registerRoot
├── Root.tsx              # IntroVideo 组合注册（1920×1080, 30fps, 900 帧）
├── IntroVideo.tsx        # 场景编排（Sequence 时长窗口 + 淡入淡出）
├── assets/
│   ├── dimo.png          # Dimo 完整图集（来自 ~/.codex/pets/dimo-4）
│   └── thumbs/           # 市场场景 10 只宠物的首帧缩略图（scripts/crop-thumbs.mjs 生成）
├── components/
│   ├── Scene.tsx         # 场景容器：开头淡入、结尾淡出，防叠压
│   ├── SceneTitle.tsx    # 场景标题（中英双语）
│   ├── PetSprite.tsx     # 宠物 sprite 动画组件（复用真实 atlas 帧）
│   └── scenes/           # 五个场景
└── scripts/crop-thumbs.mjs  # 从宠物包裁首帧缩略图
```

## 说明

- **宠物动画**：`PetSprite` 按 `useCurrentFrame` 推进帧索引，行映射与
  `apps/desktop-pet/src/renderer.ts` 的 `STATE_ANIMATION` 一致（idle/waiting/running/failed/review）。
- **中文字体**：依赖系统 Noto Sans CJK SC；无该字体的机器需在 `IntroVideo.tsx`
  中替换 font-family 或加载字体包。
- **改动后渲染**：改源码后直接 `npm run render` 即可。
