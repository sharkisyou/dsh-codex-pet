# Context Map

## Contexts

- [Pet](./plugins/pet/CONTEXT.md) — DSH Web 界面里的状态驱动悬浮宠物（宠物包与 Codex 宠物包格式兼容）
- [桌宠应用](./apps/desktop-pet/CONTEXT.md) — Tauri 桌宠：宠物窗/设置窗 + 在线宠物市场（petdex 浏览/安装/缩略图，后端驱动）+ 外观主题与中英文界面

## 桌宠外观与语言（方案要点）

> 详细词汇表见 [桌宠应用 CONTEXT.md](./apps/desktop-pet/CONTEXT.md)，决策见 [ADR 0005](./docs/adr/0005-settings-theme-and-language.md)。

- **模型**：主题模式（系统/深色/浅色）+ 深色侧主题 + 浅色侧主题 + 界面语言（系统默认/中文/English）各自持久化（`themeMode / darkTheme / lightTheme / language`）；非法值回退默认，旧 settings.json 兼容。
- **主题**：7 套主题 = 7 组 CSS 变量 token（浅色 classic/暖纸/晴空，深色石墨黑/暖夜/午夜蓝/霓虹终端），`body[data-theme]` 切换且**只作用于设置窗**；系统模式经 `matchMedia` 实时跟随 OS 深浅色。
- **语言**：`i18n.ts` 词典 + `data-i18n` 静态文案重写，切换即时生效，覆盖设置窗、宠物窗右键菜单与托盘窗；`navigator.language` 无变更事件，系统语言在窗口重开/设置同步时解析。

## 桌宠市场（方案要点）

> 详细词汇表见 [桌宠应用 CONTEXT.md](./apps/desktop-pet/CONTEXT.md)，决策见 [ADR 0004](./docs/adr/0004-online-pet-market.md)。

- **后端驱动**：市场的一切网络/文件操作由 Node 服务端（`market.ts`）完成，浏览器不直连 petdex CDN（安装写 `~/.codex/pets`、manifest 4669 条、浏览器访问不了 CDN 三个原因）。
- **协议**（内部 `/v1/ui`）：`market/list`（分页搜索 + kinds）、`market/install`、`market/uninstall`、`market/thumb`、`market/pet`。
- **安装/卸载**：zip / 单文件 → `@yshark/pet-core` 校验 → 原子写入 `~/.codex/pets/<slug>/`，失败回滚；卸载删除目录并刷新本地库。
- **缩略图**：服务端 sharp 裁 sprite 首帧 → data URL；前端懒加载 + 客户端缓存回填 + **下一页预取**（点下一页秒显）。
- **UI**：设置窗「市场」独立 tab，自适应网格 + 动态分页（列数 × 3 行，整页铺满）、**类型筛选下拉**、**宠物详情弹窗**（大图动画预览 + 描述 + 安装/卸载）、搜索/安装状态齐全；本地「宠物」页同为**自适应网格** + 卡片**删除**按钮 + **持久悬停预览**。
- **内存**：服务端图片类缓存带 LRU 上限（sprite 60 张 / 详情 20 条 / 缩略图 2000），manifest 48 小时 TTL。

## Relationships

- 桌宠应用 ↔ Pet（桥接插件）：Pet 把会话活动经 DSH 桥接转发给桌宠应用渲染；两者共享 `@yshark/pet-protocol`。
- 桌宠应用 ↔ Codex 宠物库：只读列出 `~/.codex/pets/`；在线市场安装是唯一写入路径（用户明确动作）。
