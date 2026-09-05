# 在线宠物市场（petdex.dev）

状态：accepted（扩展 ADR 0003「宠物市场」一节）

## 背景

桌宠需要一个真正的在线宠物市场：在应用内浏览 petdex.dev 的宠物并一键安装，而不是仅提供外部链接。实现前确认了三个关键事实：

- petdex API：`https://assets.petdex.dev/manifests/petdex-v1.json`（旧地址 `petdex.crafter.run/api/manifest` 已 308 迁移至此，`petdex.dev/api/manifest` 307 同目标），共 **4669** 只宠物，manifest 约 1.6MB；单宠物提供 `petJsonUrl` / `spritesheetUrl` / `zipUrl`。
- 安装必须写 `~/.codex/pets/<slug>/`：浏览器无法写文件系统，只能由 Node 服务端完成。
- 浏览器（用户侧与本环境）**无法直接访问 petdex CDN**（代理/网络限制），因此任何依赖浏览器直连 CDN 的缩略图都会空白。

结论：市场的一切网络与文件操作都由 Node 侧完成，浏览器只通过桌宠内部 WS 控制通道消费数据。

## 决策

### 市场模块（Node 侧，`apps/desktop-pet/src/market.ts`）

- **manifest 拉取 + 缓存**：默认 URL 为 petdex API；**48 小时 TTL**（`MARKET_CACHE_TTL_HOURS` 可覆盖，单位小时）；`User-Agent` 标识；**3 次指数退避重试**（容忍代理/CDN 抖动）；`fetchImpl` 可注入便于测试。
- **分页搜索**：`listPets({ query, kind, page, pageSize })` 返回 `{ pets, total }`；query 匹配名称/slug/作者/类型；pageSize 上限 100；`listKinds()` 返回全量去重类型。
- **安装** `installPet(pet)`：
  - 安装路径优先 `zipUrl`（adm-zip 解压），失败且有单文件资产时回退 `petJsonUrl` + `spritesheetUrl`。
  - 写入临时目录 → 用 `@yshark/pet-core` 的 `parsePetJson` 校验 `pet.json`（字段 + 版本）→ 校验引用的 spritesheet 存在且非空 → **原子 `rename` 到 `~/.codex/pets/<slug>/`**（覆盖旧目录）；任何一步失败即回滚删除临时目录。
  - `safeSlug`：slug 只保留 `[a-z0-9-_]`，拒绝路径穿越。
  - 下载限大小（sprite 25MB / zip 50MB）并设超时。
- **缩略图** `getThumbnail(pet)`：服务端下载 sprite → **sharp 裁第一帧（192×208）→ 缩放 96×104 → webp data URL**（约 9KB，再缓存）。前端不直连 CDN。
  - **下载健壮性**（2026-09 修复「缩略图生成失败」）：页面首屏会一次性并发请求 ~27 张 2MB 级 sprite，原 20s 单次超时 + 无并发上限 + 429/5xx 不重试，导致 CDN 突发下部分下载被终止/超时，3 次重试全灭后 `getThumbnail` 返回 null。现改为：**单次下载超时 60s**（`DEFAULT_DOWNLOAD_TIMEOUT_MS`，实测 20s 场景 5/27 失败、60s 场景 0/27）、**下载信号量上限 12**（`downloadConcurrency` 可调；同时间窗实测 6/12/27 对比：12 整页最快且失败率极低，27 无性能收益还会增加连接被断/限流风险）、**429/5xx 也退避重试**（404 等直接失败）、小尺寸 sprite 首帧兜底裁剪（`extract` 不越界）、失败记录 `[market]` 警告日志。失败经 `market/thumb-error` 结构化事件下发，前端**静默退避重试**（3s→6s→12s，最多 3 次），不再冒泡为设置窗全局错误行。
- **详情** `getPetDetail(pet)`：下载 pet.json 用 `parsePetJson` 解析（动画状态 + 描述，失败返回 null 由前端标准动画兜底）+ 整张 sprite 转 data URL（约 2.9MB），缓存。
- **卸载** `uninstallPet(slug)`：`safeSlug` 校验后删除 `~/.codex/pets/<slug>/`。
- **图片类缓存带 LRU 上限**（防止预取/翻页无限增长，曾触发 JS heap OOM）：sprite 全量缓存上限 **60 张**（≈180MB）、详情缓存上限 **20 条**（≈60MB，大头是 2.9MB base64）、缩略图上限 **2000 张**；超过按最近使用淘汰最旧。manifest 仍是时间 TTL（48h）。

### 内部协议扩展（`/v1/ui`，不进公开线协议）

在 `ui-gateway.ts` 的 UI 控制通道新增消息（与 `pet/get` 同模式）：

| 消息 | 说明 |
|---|---|
| `market/list { query?, petKind?, page?, pageSize? }` → `{ pets, total, page, pageSize, kinds }` | 分页搜索市场；`kinds` 为全量去重类型（character/creature/object）供筛选下拉 |
| `market/install { pet }` → `market/installed { id, displayName, sourceDir }` | 安装；成功后刷新并广播本地宠物库 |
| `market/uninstall { slug }` → `market/uninstalled { slug }` | 卸载；成功后刷新并广播本地宠物库 |
| `market/thumb { pet }` → `market/thumb { slug, dataUrl }` | 缩略图（服务端生成） |
| `market/thumb { pet }` → `market/thumb-error { slug }` | 缩略图生成失败（下载重试耗尽/裁图失败）；前端退避重试，不触发全局错误行 |
| `market/pet { pet }` → `market/pet { slug, pet, spriteDataUrl }` | 详情：解析后的 `ParsedPet`（可空，前端用标准动画兜底）+ 整张 sprite data URL（大图动画预览） |

### 前端（设置窗「市场」独立 tab）

- 侧边导航：设置 / 宠物 / **市场**（购物袋图标），首次进入自动加载。
- **自适应网格 + 动态分页**：网格 `repeat(auto-fill, minmax(150px, 1fr))`；每页数量 = **实际列数 × 3 行**（如 9 列 → 27 个/页），保证整页铺满无空缺；窗口缩放列数变化时自动重排当前页。
- 搜索（名称/作者/类型，防抖 300ms）自动回到第 1 页；**类型筛选下拉**（`market/list` 的 `kinds` 填充，切换重置第 1 页）；分页条 `‹ 上一页 | 第 X / N 页 | 下一页 ›`，边界禁用。
- **缩略图懒加载 + 下一页预取**：`IntersectionObserver` 仅对可见卡片请求 `market/thumb`；客户端维护 **slug → dataURL 缓存**，搜索/翻页重建列表后直接回填（避免"重建后缩略图空白"）。**预取流水线**：当前页缩略图全部到位（或 5s 兜底）后，后台请求下一页列表（带当前搜索/类型/每页数，不渲染）→ 缓存并分批（每批 6、间隔 250ms）预取下一页全部缩略图 → 点「下一页」时从缓存秒显（~50ms，零往返）→ 再预取再下一页；搜索/类型/缩放变化时丢弃过期预取。
- **宠物详情**：点卡片打开弹窗，`market/pet` 返回解析后的 pet + 整张 sprite data URL，用 DOM 渲染器做**大图动画预览**；含完整描述、安装/卸载按钮（与卡片状态同步）、petdex 链接；✕ / 点遮罩 / Esc 关闭。**加载动画**：浅蓝磨砂方框（带边框 + 外发光）由小到大扩张并淡出（循环 1.3s），铺满预览容器、最大时与磨砂背景重合；数据到达后**至少完整播放一轮**再消失，避免秒到时动画一闪而过。
- **安装/卸载交互**：`安装 → 安装中 → 已安装`；已装检测（与本地库 `sourceDir` 比对）；安装后本地「宠物」列表即时出现新宠物（`setPets` 同步重渲染市场卡片状态）。**本地「宠物」页每张卡片新增「删除」按钮**（确认框后经 `market/uninstall` 删除，删除当前选中宠物时同时重置选择）；详情弹窗对已装宠物显示「卸载」按钮。
- **宠物页浏览体验**：本地宠物列表改为与市场一致的**自适应网格**（`repeat(auto-fill, minmax(150px, 1fr))`，紧凑列式卡片：缩略图/名称/描述/「使用 + 删除」按钮并排）；**悬停预览持久化**——预览停留在最近悬停的宠物上，鼠标移出列表（任何方向）不再回落当前宠物，仅悬停另一只或目标被删除时更新；「设为桌宠」按钮始终可见。

## 影响

- 新增：`market.ts`（Node 市场模块）、`market-types.ts`（浏览器安全共享类型）、`test/market.test.ts`。
- 修改：`ui-gateway.ts`（市场消息：list/install/thumb/pet）、`server-entry.ts`（注入 market）、`ui-client.ts`（请求方法 + 处理器）、`settings-app.ts`（市场 tab UI + 类型筛选 + 详情弹窗）、`main.ts`（市场消息接线）。
- 新增依赖：`adm-zip`（zip 解压）、`sharp`（缩略图/详情裁图）。
- 数据：安装会把宠物写入 `~/.codex/pets/<slug>/`，覆盖 ADR 0003「桌宠不负责导入」的旧决策——安装是用户明确的动作，与 pet-library 的"只读列出"定位共存。
- 后续候选：更新检测（有新版本提示重装）、一键更新、安装记录。（缩略图并发限流已随下载健壮性修复落地，见上。）
- 已实现补充：卸载（`market/uninstall` → 删除 `~/.codex/pets/<slug>/` 并刷新本地库；本地「宠物」页卡片「删除」按钮 + 详情弹窗「卸载」按钮）。
