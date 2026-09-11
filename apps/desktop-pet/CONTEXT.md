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
由服务端从 sprite 首帧（192×208）裁剪并缩放生成的 webp data URL（约 9KB），前端懒加载并使用客户端 id→dataURL 缓存回填；不直接加载 petdex CDN 图片。下载带 60s 超时 + 6 并发信号量 + 429/5xx 重试；生成失败经 `market/thumb-error` 下发，前端退避重试（3s→6s→12s，最多 3 次）后静默留空。**市场卡片与本地宠物卡片共用同一套**（`pet-thumbnail.ts`；本地走内部协议 `pet/thumb`，读图集用 `library.loadSpriteBuffer`，不转 base64、不进整张精灵 LRU）；本地卡片以前直接铺整张精灵，5 只就把设置窗渲染进程堆顶到 ~100MB。
_Avoid_: 封面, 预览图, 卡片直接铺整张精灵（`backgroundSize: 512px 576px` 那套已废弃）

**状态广播去重 (State-sync Dedupe)**:
`ui-gateway` 的 `controller.subscribe` 回调在广播 `state-sync` 前先比对该消息的 JSON 指纹，**内容没变就不发**。DSH 会话活跃时 controller 会高频通知，但绝大多数通知产出的快照逐字节相同（改造前实测最忙一分钟 511 次/窗口）——源头去掉后，pet server 的序列化/发送与所有窗口的解析+DOM更新+日志一起省掉（前端 `petLog` 那层去重只是末端兜底）。注意：真实变化（settings/agents/activity/tray 任一不同）必须照发，别把变化吞掉。
_Avoid_: 前端去重当唯一防线, 无脑节流（会把真实状态变化延迟）, 每窗口各自订阅 controller

**帧步进唤醒 (Frame-paced Ticking)**:
`dom-pet-renderer` 不再用 `requestAnimationFrame` 每 16ms 空转：`nextFrameDelayMs(anim, elapsed)` 按图集 timing 算出**到下一帧边界**的毫秒数再 `setTimeout`（最小 4ms、最大 1000ms；单帧动画与"已播完的 once 动画"长睡）。`frameRate > 0` 仍可显式指定固定节流间隔。
_Avoid_: 60Hz 空转 rAF（图集帧时长本就是 140ms 量级）, 固定 16ms 定时器


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

**设置窗按显隐挂载/卸载 (Settings Mount Lifecycle)**:
设置窗由 `tauri.conf.json` 以 `visible:false` 预创建（为预布局/避免创建期闪现），但**只在显示期间持有内容**：启动时不挂载，`settings-shown` 时挂载，`settings-hidden`（关闭被拦成 hide 之后）时**卸载**——`app.dispose()`（解绑全局监听/定时器/缩略图观察者 + 停 3 个动画渲染器 + 清空 `petData`/DOM）+ `client.close()`。整套设置 UI 常驻实测渲染进程 ~107MB（空页面 ~15MB），大头是本地宠物页几张整张精灵解码后的位图。信号：主进程 `open_settings_window` 在 `show()` **之前** emit 的 `settings-shown`、`CloseRequested`→hide 后 emit 的 `settings-hidden`、DOM `visibilitychange` 兜底，另加启动时一次 `isVisible()` 检查；全部幂等，不轮询（隐藏窗口保持零活动）。挂载时才建 ui-client，由它取一份全量快照，因此不会显示过时数据。
实测（2026-09-11，9 进程私有工作集，基线=从未打开过设置窗）：从未打开 ~206MB → 打开时 ~400MB → 关闭卸载后 ~230MB（≈回到基线 +24MB）。**卸载能立刻还回 GPU 进程的 ~145MB；渲染进程的堆必须靠 `location.reload()` 才肯归还**（只清 DOM 时渲染进程稳定停在 ~108MB，重载后降到 ~78MB）——重载发生在窗口隐藏期间，用户不可见，下次显示时页面已就绪。
_Avoid_: 启动即建设置 UI（隐藏窗口白养一套前端）, 关闭时不卸载（马甲窗常驻整套 UI，~282MB）, 卸载后不重载（渲染进程堆不归还）, 隐藏窗口轮询可见性, 挂载前缓存快照再回放（重复实现一遍快照状态）

**设置窗铺满工作区 (Settings Work-Area Expand)**:
设置窗首次显示时铺满显示器工作区（走隐藏期的 `set_size`/`set_position`，不用 `maximized` 创建——tao 创建期会先 SW_MAXIMIZE 让窗口闪现，见 `main.rs`）。**实测推迟到首次打开再做并不省内存**（2026-09-11 A/B：隐藏窗口铺满工作区但内容为空时，渲染进程/GPU 与其 520×640 版本几乎无差，GPU 差在噪声内），因此保留启动时预展开。
_Avoid_: 用 maximized 创建（启动瞬间全屏闪现）, 把它当作内存优化项

**桌宠日志 (Pet Log)**:
前端 `petLog` 双写 console 与 `%USERPROFILE%\dsh-pet.log`（`pet_log_append`）。Rust 侧**常驻文件句柄**（不再每行 open/close），超 **2MB 轮转**为 `dsh-pet.log.old`（只留一份；Windows 上改名要求先释放句柄）。前端按**键去重**：同一行（scope+message+data）在 5s 窗口内只落一次，行尾 `×N` 是这一行代表的重复次数——状态同步（`applyActivity`/`applyTray`/`setState`）逐轮交替出现，只压"相邻重复"没用（实测仅 1.5×），按键去重实测约 4×~6×（最忙的一分钟 ~40×）。
_Avoid_: 逐行 open/close 文件, 只做相邻行去重, 无上限增长（旧版 3MB/小时）

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
