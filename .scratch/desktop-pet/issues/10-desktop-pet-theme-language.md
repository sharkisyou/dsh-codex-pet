# 10 — 桌宠：设置窗外观（7 套主题）+ 界面语言（系统默认/中文/English）

**What to build:** 设置窗口支持外观主题与界面语言：模式（系统 / 深色 / 浅色）三选一，深色侧与浅色侧主题各自独立选择（深色 4 套、浅色 3 套），「系统」跟随 OS 深浅色自动取对应侧；界面语言三选一（系统默认 / 中文 / English），切换即时生效并覆盖设置窗、宠物窗右键菜单与托盘窗。全部字段持久化并在重启后恢复。

**Blocked by:** 06 — 桌宠：宠物库 + 设置窗 + 持久化（设置存储与 `/v1/ui` 通道已就绪）

**Status:** resolved

- [x] 设置窗「外观」组提供主题卡片（模式分段 + 深色主题/浅色主题下拉）与语言卡片（系统默认/中文/English 分段），无说明文案与"当前生效"读数。
- [x] 7 套主题 = 7 组 CSS 变量 token（浅色 classic/warm-paper/clear-sky，深色 graphite/warm-night/midnight/neon），`body[data-theme]` 切换，只作用于设置窗口。
- [x] 「系统」主题模式经 `matchMedia('(prefers-color-scheme: dark)')` 实时跟随 OS 深浅色，不刷新切换。
- [x] 界面语言：`i18n.ts` 词典（zh/en）+ `t(key, params)`；静态文案 `data-i18n` 统一重写、动态文案由渲染函数重算；「系统」按 `navigator.language` 解析。
- [x] 全部字段（`themeMode` / `darkTheme` / `lightTheme` / `language`）经 `/v1/ui` `settings/update` 持久化到 settings.json，非法值回退默认，旧文件向后兼容。

## Answer

Implemented in `apps/desktop-pet` and documented in `docs/adr/0005-settings-theme-and-language.md`（扩展 ADR 0003「设置持久化」字段列表）。方向经一次性原型 `prototype/settings-dark-theme.html`（gitignore 内）验证后落生产。

- `src/app-constants.ts` — 主题/语言词汇表（类型 + ID 数组；显示名在 i18n 词典）。
- `src/i18n.ts` — zh/en 词典（约 100 条）+ `t(key, params)` + `resolveLanguage` / `setLanguage`。
- `src/settings-store.ts` — 新字段 + clamp/sanitize；`src/ui-gateway.ts` — `settings/update` 白名单放行。
- `src/settings-app.ts` — 外观卡片组 + `applyTheme`（含 matchMedia 监听）+ `applyLanguage`（`data-i18n` 静态文案重写 + 渲染函数重算动态文案）。
- `src/main.ts` — 宠物窗右键菜单/角标提示、托盘窗标题与空态、各窗口标题随语言设置。
- `src/style.css` — 设置窗口颜色全部 token 化（`body.settings-window` 作用域）+ 7 套主题 + 霓虹终端结构性覆盖（直角/等宽/辉光/网格背景）。

Tests: `test/settings-store.test.ts`（新字段 sanitize 与持久化）；typecheck 与全量 75 测试通过；另以隔离实例（`PET_SERVER_PORT` + `DSH_PET_DATA_DIR` 指向临时目录）经 CDP 做了端到端验证：点击 → 持久化 → 广播 → 各窗口应用、刷新恢复、OS 深浅色实时跟随、中英切换全窗生效（截图核对过中英两版设置页）。
