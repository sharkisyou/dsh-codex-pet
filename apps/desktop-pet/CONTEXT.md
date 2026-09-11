# 桌宠应用（apps/desktop-pet）

Tauri 2 + Vite + 原生 TypeScript 的桌宠应用：透明置顶宠物窗 + 设置窗，Web 前端通过内部 WS 控制通道（`/v1/ui`）与 Node 服务端通信；服务端读 Codex 宠物库、持久化设置、提供在线宠物市场。

## Language

**在线宠物市场 (Pet Market)**:
设置窗内的独立 tab（设置 / 宠物 / 市场），从 petdex.dev 浏览并一键安装宠物包。市场的一切网络/文件操作由 Node 服务端完成，浏览器不直连 petdex。
_Avoid_: 市场链接, 外部画廊入口

**市场条目 (Market Pet)**:
petdex manifest 中的一只宠物，字段为 `slug / displayName / kind / submittedBy / spritesheetUrl / petJsonUrl / zipUrl`。
_Avoid_: 市场卡片, 宠物记录

**安装 (Install)**:
把市场条目对应的资源包（zip 或 pet.json + spritesheet）下载、校验并原子写入 `~/.codex/pets/<slug>/`；成功后本地宠物库即时刷新。与 pet-library 的"只读列出"定位共存（安装是用户明确动作）。
_Avoid_: 导入, 下载

**缩略图 (Thumbnail)**:
由服务端从 sprite 首帧（192×208）裁剪并缩放生成的 webp data URL（约 9KB），前端懒加载并使用客户端 slug→dataURL 缓存回填；不直接加载 petdex CDN 图片。下载带 60s 超时 + 6 并发信号量 + 429/5xx 重试；生成失败经 `market/thumb-error` 下发，前端退避重试（3s→6s→12s，最多 3 次）后静默留空。
_Avoid_: 封面, 预览图

**动态分页 (Dynamic Pagination)**:
市场按"网格实际列数 × 3 行"计算每页数量（如 9 列 → 27 个/页），保证整页铺满；窗口缩放列数变化时自动重排当前页。
_Avoid_: 固定每页条数

**主题模式 (Theme Mode)**:
设置窗外观的三选一：`system / dark / light`。决定使用深色侧还是浅色侧主题；`system` 跟随 OS `prefers-color-scheme`（matchMedia 监听，实时切换，无需刷新）。
_Avoid_: 亮暗自动切换（与"跟随系统"语义混淆）, 夜间模式

**主题 (Theme)**:
7 套语义 CSS 变量 token 集：浅色侧 `classic / warm-paper / clear-sky`，深色侧 `graphite / warm-night / midnight / neon`。以 `body.settings-window[data-theme=…]` 切换，**只作用于设置窗口**；主题可覆盖圆角/字体/阴影（霓虹终端的直角 + 等宽 + 辉光），不只是换色。
_Avoid_: 皮肤, 散落的硬编码色值

**界面语言 (UI Language)**:
`system / zh / en` 三选一；`system` 按 `navigator.language` 解析（窗口加载与设置同步时）。词典在 `i18n.ts`（zh/en 各约 100 条），静态文案挂 `data-i18n` 由 `applyLanguage` 重写，动态文案由渲染函数重算；覆盖设置窗、宠物窗右键菜单与托盘窗。
_Avoid_: 运行时翻译框架, 机器翻译

**精灵 bbox (Sprite Box)**:
精灵元素（`.pet`）的几何矩形 × devicePixelRatio 换算的物理像素矩形，相对窗口左上角。窗口位置钳制的参照物——窗口大部分是透明边距，"窗口可见"≠"宠物可见"。与点击穿透 spec 的像素级 bbox 不同，钳制用稳定的元素矩形（不随动画帧抖动）。
_Avoid_: 窗口矩形（透明边距会算成可见）, 像素级不透明外接矩形（点击穿透的 wontfix 方案）

**位置钳制 (Window Clamp)**:
防宠物拖出屏幕丢失的位置约束，纯函数在 `window-clamp.ts`。边界是显示器**完整边界**（含任务栏，宠物允许坐任务栏），多显示器取并集。分两档：**软钳制**（拖动中）至少一半精灵留在并集内、允许贴边半露但不许大半藏出屏幕；**硬钳制**（启动/设置恢复）把精灵完整拉回坐标所在显示器（不命中任何屏则主显示器），治愈分辨率变更/拔屏后的旧档。
_Avoid_: 工作区钳制（会禁止坐任务栏）, 窗口级钳制（透明边距导致"可见"误判）, 32px 可见条（旧方案，用户实测后否决）

**拖动锚点 (Drag Anchor)**:
一次拖动开始时锚定的"窗口外框物理坐标 + 光标屏幕坐标"对，此后每帧按光标增量 `setPosition`，并按**按下序号**校验归属。锚点取自宿主的**缓存**（`onMoved` 事件维护），pointerdown 不同步走 IPC 现查——现查期间（实测中位 28ms、长尾 119ms）到达的 pointermove 会被丢弃，快甩手势会整段失效。状态机在 `drag-controller.ts`：5px 阈值、软钳制、**松手先同步补最后一帧再清状态**。
_Avoid_: 拖动阈值, 拖动起点, 窗口位置现查

**宠物面 (Pet Surface)**:
允许起拖的"宠物本体"命中面 = 精灵元素 `#pet` ∪ 待机剪影 `#pet-standby`，判定在 `pet-drag-surface.ts` 的 `isPetSurfaceTarget`（`Element.contains`，宠物面内的子元素自动算本体）。宠物窗是 345×356 的矩形而精灵只占中间 216×234，四周透明边距在 DOM 里同样命中 `.pet-stage`——**不判定就等于整窗都能拖**（2026-09-10 用户实测："拖宠物旁边的空白区，宠物也跟着动"）。与 `cursor: grab`、右键菜单的命中区保持一致；拖动中的指针捕获仍挂在 stage 上（只判起点，不拦 move/up）。
_Avoid_: 整窗拖动热区, 不透明像素 bbox（那是点击穿透的取舍，见 `.scratch/pet-clickthrough/`）, 窗口矩形命中

**宠物窗尺寸 (Pet Window Size)**:
宠物窗尺寸**只由设置里的 `zoom` 决定**：设置窗「缩放」滑块 → 服务端 → 广播 → 宠物窗 `applyZoom` 的 `setSize`。宠物窗自身既**不可拉伸**（`tauri.conf.json` 的 `resizable: false`，没有 `WS_THICKFRAME` 那圈隐形拉伸手柄），也**没有滚轮/双指手势缩放**（2026-09-10 用户拍板移除）——既防误触改大小，也让窗口边缘的按下不再被 OS 抢去改尺寸、而是正常起拖。
_Avoid_: Ctrl+滚轮缩放（已移除）, 可拖边拉伸的宠物窗, 手改窗口尺寸

**位置存档 (Position Persistence)**:
窗口位置的三层落盘：**服务端 `settings.json` 是权威**（经 WS `settings/update` 写入，设置窗与宠物窗共用）；断线时 `ui-client` 把最后一笔设置补丁**按 key 合并留槽**、重连拉到全量快照**之后**补发（`settings-replayed`，顺序不能反，否则被旧快照覆盖）；宠物窗另存一份 `localStorage`（`pet-position-cache.ts`）作为**本地兜底**——启动先用它定位（服务端没起来也能回到上次位置），与本地不一致时回推一次让服务端收敛。丢弃与补发都有日志（`send-dropped` / `settings-replayed` / `position-reconciled`）。
_Avoid_: 只落 localStorage（服务端才是权威）, 静默丢弃（已修，有日志）, 靠重启恢复（不解决丢写）

**托盘会话聚焦 (Tray Session Focus)**:
托盘点会话 = 网页内切换会话（`sessions.open`）**加上**把承载 GUI 的浏览器窗口/标签页带到前台，两层缺一不可（只切会话用户看不到，只置前窗口用户看到的是别的标签页）。识别 GUI 靠页面标题 `<会话标题> — DeepSeek Harness` 里的产品名标记（`dsh_focus.rs` 的 `DSH_MARKER`，会话标题用于多 GUI 标签页消歧）；**窗口标题只反映活动标签页**，所以“GUI 在后台标签页”时用 UI Automation 读标签页列表并 `SelectionItemPattern.Select()` 选中它。Windows 实现在 `src-tauri/src/dsh_focus.rs`。
_Avoid_: 按「窗口标题含 deepseek」匹配（旧 bug 根源：DeepSeek 官网/搜索页也含它 → 误判成 GUI 窗口，只置前不切标签页）, 只置前不切标签页, 每点一次开一个新标签页

## 外观与语言（方案要点）

- **模型**：模式（系统/深色/浅色）+ 深色侧主题 + 浅色侧主题三件套各自持久化（`themeMode / darkTheme / lightTheme`），语言为 `language` 字段；非法值 sanitize 回退默认（system / graphite / classic / system），旧 settings.json 向后兼容。
- **主题机制**：设置窗全部颜色收敛为约 40 个语义 token（`style.css`，`body.settings-window` 作用域），7 套主题 = 7 组 `data-theme` 覆盖；设置窗自行解析并写 `data-theme`，系统模式经 `matchMedia` 实时跟随 OS 深浅色。
- **语言机制**：`i18n.ts` 词典 + `t(key, params)`；静态文案 `data-i18n` 标记统一重写、动态文案由渲染函数重算，切换即时生效；`navigator.language` 无变更事件，系统语言改动在窗口重开/设置同步后生效（平台差异，与主题的系统跟随不同）。
- **UI**：设置窗「外观」组 = 主题卡片（模式分段 + 双侧主题下拉）+ 语言卡片（系统默认/中文/English 分段）；无说明文案与"当前生效"读数。
- **词汇表**：语言选项显示名（中文/English）与主题显示名（如 Neon Terminal）都在 `i18n.ts` 词典内，不在常量里。
- **决策记录**：见 [`../../docs/adr/0005-settings-theme-and-language.md`](../../docs/adr/0005-settings-theme-and-language.md)（扩展 ADR 0003「设置持久化」字段列表）；方向经一次性原型 `prototype/settings-dark-theme.html`（gitignore 内）验证。

## 在线宠物市场（方案要点）

- **架构**：一切网络/文件操作走 Node 服务端（`market.ts`），浏览器只通过内部 WS 消费数据——因为安装要写 `~/.codex/pets`、manifest 1.6MB/4669 条太重、且浏览器访问不了 petdex CDN。
- **后端模块** `src/market.ts`：manifest 拉取 + **48 小时缓存**（`MARKET_CACHE_TTL_HOURS` 可覆盖，单位小时）+ 3 次重试；下载**单次超时 60s**（曾 20s 在页面首屏 27 张并发下载下被打穿 → 缩略图生成失败）、**并发信号量上限 12**（同时间窗实测 6/12/27 对比：12 最快且失败率极低，27 无性能收益还增加连接被断风险）、**429/5xx 退避重试**（404 直接失败）；`listPets({ query, kind, page, pageSize }) → { pets, total }` + `listKinds`；`installPet`（zip/单文件 + `@yshark/pet-core` 校验 + 原子写盘 + 回滚 + `safeSlug` 防穿越）；`uninstallPet`；`getThumbnail`（sharp 裁首帧 → data URL；小尺寸 sprite 兜底整体裁剪）；`getPetDetail`（解析 pet + 全 sprite data URL）。**图片类缓存带 LRU 上限**（sprite 60 张 / 详情 20 条 / 缩略图 2000 张），防止预取翻页导致 OOM。
- **内部协议**（`/v1/ui`，不进公开线协议）：`market/list`（分页 + kinds）、`market/install`、`market/uninstall`、`market/thumb`、`market/pet`。
- **前端**（设置窗「市场」tab）：自适应网格 + 动态分页、搜索（防抖、重置第 1 页）、**类型筛选下拉**、`IntersectionObserver` 懒加载缩略图 + 客户端缓存 + **下一页预取流水线**（当前页缩略图到位后后台预取下一页列表与缩略图，点下一页秒显）、**宠物详情弹窗**（`market/pet` 大图动画预览 + 描述 + 安装/卸载；浅蓝磨砂方框加载动画由小变大到铺满预览容器再淡出，**至少完整播放一轮**）、`安装 → 安装中 → 已安装` 状态与已装检测。
- **宠物页体验**：本地宠物列表为**自适应网格**（与市场一致，紧凑列式卡片 + 使用/删除按钮）；**悬停预览持久化**（移出列表不回落当前宠物，「设为桌宠」按钮始终可见）。
- **依赖**：`adm-zip`（zip 解压）、`sharp`（缩略图/详情裁图）。
- **决策记录**：见 [`../../docs/adr/0004-online-pet-market.md`](../../docs/adr/0004-online-pet-market.md)（扩展 ADR 0003「宠物市场」一节）。
- **卸载**：`market/uninstall` 删除 `~/.codex/pets/<slug>/` 并刷新本地库；本地「宠物」页卡片「删除」按钮（确认框，删除当前选中宠物时重置选择）+ 详情弹窗「卸载」按钮（状态与卡片同步）。
- **后续候选**：更新检测（有新版本提示重装）、一键更新、安装记录。（缩略图并发限流已随下载健壮性修复落地。）
