# 设置窗口外观（7 套主题）与界面语言（中英文）

状态：accepted（扩展 ADR 0003「设置持久化」的字段列表）

## 背景

设置窗口只有一套硬编码浅色配色，文案为构建时写死的中文字面量。需求：深色与浅色多主题可选、界面语言可选（系统默认 / 中文 / English）。

实现前用一次性原型（`apps/desktop-pet/prototype/settings-dark-theme.html`，gitignore 内）验证了两个问题：

- 主题方向：4 套深色（石墨黑 / 暖夜 / 午夜蓝玻璃 / 霓虹终端）+ 2 套新浅色（暖纸 / 晴空玻璃）与浅色现状对照，7 套全部保留；
- 选择器交互：设置页「外观」组提供**模式**（系统 / 深色 / 浅色）三选一，另有**深色主题**与**浅色主题**两个下拉各自独立选择——「系统」跟随 OS 深浅色取对应侧，另一侧的选择先记住、切过去时生效。卡片不带说明文案与"当前生效"读数（用户明确要求去掉）。

## 决策

### 外观数据模型

`settings.json` 新增三个字段（sanitize 对非法值回退默认；旧文件无字段按默认处理，向后兼容）：

- `themeMode: 'system' | 'dark' | 'light'`（默认 system）
- `darkTheme: 'graphite' | 'warm-night' | 'midnight' | 'neon'`（默认 graphite）
- `lightTheme: 'classic' | 'warm-paper' | 'clear-sky'`（默认 classic）
- `language: 'system' | 'zh' | 'en'`（默认 system）

词汇表常量放 `app-constants.ts`（浏览器安全模块）；`ui-gateway` 的 `settings/update` 白名单逐字段放行并 clamp 后转交 controller。

### 主题 = CSS 变量 token 集

- 设置窗口的全部颜色收敛为约 40 个语义 token（`--bg-window` / `--text-strong` / `--card-*` / `--accent*` / `--ok-*` / `--danger*` 等），定义在 `style.css` 的 `body.settings-window` 作用域——**默认基准即原浅色硬编码值**，7 套主题是 7 组 `body.settings-window[data-theme=…]` 覆盖。宠物窗 / 托盘窗样式不受影响。
- 每套主题声明 `color-scheme`（原生控件深浅色）；霓虹终端主题额外允许结构性覆盖（直角卡片、等宽字标签、辉光、网格背景）——主题不止换色，可覆盖圆角/字体/阴影。
- **生效路径**：设置窗自行解析 `resolveThemeId(settings, matchMedia)` 并写 `document.body[data-theme]`；「系统」模式用 `matchMedia('(prefers-color-scheme: dark)')` 监听，OS 深浅色切换**不刷新实时跟随**。设置广播到所有窗口，但只有设置窗消费主题。

### 界面语言 = 词典 + data-i18n 重写

- 新模块 `i18n.ts`（浏览器安全）：zh/en 词典各约 100 条，`t(key, params)` 支持 `{name}` 占位符；缺 key 回退中文再回退 key。
- **静态文案**在构建时经 `i18n(el, key)` 辅助挂 `data-i18n`（placeholder 用 `data-i18n-placeholder`），`applyLanguage()` 统一重写；**动态文案**（状态行、宠物/市场列表、计数、确认框等）由既有渲染函数在语言切换后重算。语言切换即时生效，不需要重启。
- 语言解析：显式选择优先；`system` 按 `navigator.language`（Tauri WebView 反映 OS 语言），非 `zh*` 一律英文。`navigator.language` 没有变更事件，因此「系统默认」在窗口加载与设置同步时解析——OS 语言改动在窗口重开后生效（与主题的系统跟随不同，这是平台差异）。
- 语言设置覆盖三个窗口：设置窗全量文案、宠物窗右键菜单（Settings/Hide）与角标提示、托盘窗标题/空态/连接提示（随 `state-sync` 携带的 settings 应用）。

## 涉及文件

- `src/app-constants.ts` — 主题/语言词汇表
- `src/i18n.ts` — 词典与取词
- `src/settings-store.ts` — 新字段 + sanitize
- `src/ui-gateway.ts` — settings/update 白名单
- `src/settings-app.ts` — 外观/语言卡片、applyTheme/applyLanguage
- `src/main.ts` — 宠物窗/托盘窗文案与窗口标题
- `src/style.css` — 设置窗口 token 化 + 7 套主题
- `test/settings-store.test.ts` — 新字段 sanitize/持久化

## 后果

- 主题只覆盖设置窗口；宠物窗（透明）与托盘窗维持固定深色，后续如需跟随可复用同一 `data-theme` 机制。
- 「系统」语言跟随不含实时监听（平台限制）；系统模式下的主题跟随则有实时监听，两者行为不一致是有意为之。
- 新增 UI 文案时必须同时补 zh/en 词典，缺 key 会静默回退中文（不会崩，但英文界面会漏译）。
