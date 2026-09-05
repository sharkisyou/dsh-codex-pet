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

## 在线宠物市场（方案要点）

- **架构**：一切网络/文件操作走 Node 服务端（`market.ts`），浏览器只通过内部 WS 消费数据——因为安装要写 `~/.codex/pets`、manifest 1.6MB/4669 条太重、且浏览器访问不了 petdex CDN。
- **后端模块** `src/market.ts`：manifest 拉取 + **48 小时缓存**（`MARKET_CACHE_TTL_HOURS` 可覆盖，单位小时）+ 3 次重试；下载**单次超时 60s**（曾 20s 在页面首屏 27 张并发下载下被打穿 → 缩略图生成失败）、**并发信号量上限 6**、**429/5xx 退避重试**（404 直接失败）；`listPets({ query, kind, page, pageSize }) → { pets, total }` + `listKinds`；`installPet`（zip/单文件 + `@yshark/pet-core` 校验 + 原子写盘 + 回滚 + `safeSlug` 防穿越）；`uninstallPet`；`getThumbnail`（sharp 裁首帧 → data URL；小尺寸 sprite 兜底整体裁剪）；`getPetDetail`（解析 pet + 全 sprite data URL）。**图片类缓存带 LRU 上限**（sprite 60 张 / 详情 20 条 / 缩略图 2000 张），防止预取翻页导致 OOM。
- **内部协议**（`/v1/ui`，不进公开线协议）：`market/list`（分页 + kinds）、`market/install`、`market/uninstall`、`market/thumb`、`market/pet`。
- **前端**（设置窗「市场」tab）：自适应网格 + 动态分页、搜索（防抖、重置第 1 页）、**类型筛选下拉**、`IntersectionObserver` 懒加载缩略图 + 客户端缓存 + **下一页预取流水线**（当前页缩略图到位后后台预取下一页列表与缩略图，点下一页秒显）、**宠物详情弹窗**（`market/pet` 大图动画预览 + 描述 + 安装/卸载；浅蓝磨砂方框加载动画由小变大到铺满预览容器再淡出，**至少完整播放一轮**）、`安装 → 安装中 → 已安装` 状态与已装检测。
- **宠物页体验**：本地宠物列表为**自适应网格**（与市场一致，紧凑列式卡片 + 使用/删除按钮）；**悬停预览持久化**（移出列表不回落当前宠物，「设为桌宠」按钮始终可见）。
- **依赖**：`adm-zip`（zip 解压）、`sharp`（缩略图/详情裁图）。
- **决策记录**：见 [`../../docs/adr/0004-online-pet-market.md`](../../docs/adr/0004-online-pet-market.md)（扩展 ADR 0003「宠物市场」一节）。
- **卸载**：`market/uninstall` 删除 `~/.codex/pets/<slug>/` 并刷新本地库；本地「宠物」页卡片「删除」按钮（确认框，删除当前选中宠物时重置选择）+ 详情弹窗「卸载」按钮（状态与卡片同步）。
- **后续候选**：更新检测（有新版本提示重装）、一键更新、安装记录。（缩略图并发限流已随下载健壮性修复落地。）
