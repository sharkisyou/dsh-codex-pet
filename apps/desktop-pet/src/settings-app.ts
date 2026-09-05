/**
 * 设置窗口 UI（视觉迁移自 CodexPetDesk 的设置面板，适配本仓库数据流）。
 *
 * 仍然在 Tauri 设置 webview 内以编程方式构建 DOM（沿用本仓库
 * mountSettingsApp 的约定），但改为「侧边栏 + 内容卡片」布局：
 * - 侧边栏：品牌 + 设置/宠物 两个导航页 + 连接状态
 * - 设置页：宠物选择、缩放、唤醒、存储、已连接来源、关于 卡片
 * - 宠物页：搜索 + 本地宠物卡片列表
 *
 * 数据流不变：通过 UiClient 读取 controller 的状态快照并提交设置补丁。
 */

import { PROTOCOL_VERSION } from '@yshark/pet-protocol'
import type { ParsedPet } from '@yshark/pet-core'

import {
  APP_NAME,
  APP_VERSION,
  ZOOM_MAX,
  ZOOM_MIN,
} from './app-constants.js'
import { createDomPetRenderer } from './dom-pet-renderer.js'
import type { AppStateSnapshot } from './controller.js'
import type { UiClient } from './ui-client.js'
import type { MarketPet } from './market-types.js'

export interface SettingsApp {
  readonly root: HTMLElement
  update(state: AppStateSnapshot): void
  setAgents(agents: string[]): void
  setPets(pets: AppStateSnapshot['pets']): void
  setSettings(settings: AppStateSnapshot['settings']): void
  setError(message: string | null): void
  /** 收到某个宠物的完整数据（pet/get 响应），用于预览与缩略图。 */
  setPetPayload(payload: { id: string; pet: ParsedPet; spriteDataUrl: string }): void
  /** 在线市场列表（market/list 响应，含分页信息与类型集合）。 */
  setMarketPets(payload: { pets: MarketPet[]; total: number; page: number; pageSize: number; kinds: string[] }): void
  /** 市场列表加载失败：必须复位加载态，否则「下一页/搜索」会永远无响应。 */
  setMarketListError(message: string): void
  /** 某只市场宠物安装完成（market/installed 响应）。 */
  markMarketInstalled(info: { id: string; displayName: string; sourceDir: string }): void
  /** 某只市场宠物卸载完成（market/uninstalled 响应）。 */
  markMarketUninstalled(payload: { slug: string }): void
  /** 某只市场宠物的缩略图（market/thumb 响应，data URL）。 */
  setMarketThumb(payload: { slug: string; dataUrl: string }): void
  /** 某只市场宠物缩略图生成失败（market/thumb-error 响应）；前端静默退避重试。 */
  setMarketThumbError(payload: { slug: string }): void
  /** 某只市场宠物的详情（market/pet 响应，用于大图预览）。 */
  setMarketPet(payload: { slug: string; pet: ParsedPet | null; spriteDataUrl: string | null }): void
}

function h(tag: string, className?: string, text?: string): HTMLElement {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

function p(text: string, className?: string): HTMLParagraphElement {
  const el = document.createElement('p')
  if (className) el.className = className
  el.textContent = text
  return el
}

function card(title: string): HTMLElement {
  const section = h('section', 'settings-card')
  section.appendChild(h('div', 'settings-section-title', title))
  return section
}

export function mountSettingsApp(root: HTMLElement, client: UiClient): SettingsApp {
  root.innerHTML = ''
  root.className = 'settings-root'

  /* ---------- 侧边栏 ---------- */

  const sidebar = h('aside', 'settings-sidebar')

  const brand = h('div', 'settings-brand')
  const brandMark = h('span', 'brand-mark', '宠')
  const petMeta = h('div', 'pet-meta')
  petMeta.appendChild(h('strong', '', APP_NAME))
  const metaVersion = h('span', '', `Desktop Pet v${APP_VERSION}`)
  petMeta.appendChild(metaVersion)
  brand.append(brandMark, petMeta)

  const nav = h('nav', 'settings-nav')

  // 导航图标：内联 SVG（比字符图标 ⚙/□ 清晰，随主题色变化）
  const settingsIcon = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.3"/>' +
    '<line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.3"/></svg>'
  )
  const petsIcon = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
    '<circle cx="5.5" cy="8.5" r="2.1"/><circle cx="11" cy="5.5" r="2.1"/>' +
    '<circle cx="16.5" cy="8.5" r="2.1"/><circle cx="7.5" cy="13.8" r="2.1"/>' +
    '<circle cx="16.5" cy="13.8" r="2.1"/>' +
    '<path d="M12 11.3c2.9 0 5 2.7 5 4.8 0 2.3-2.1 3.9-5 3.9s-5-1.6-5-3.9c0-2.1 2.1-4.8 5-4.8z"/></svg>'
  )
  const settingsTab = h('button', 'tab-button is-active', '')
  settingsTab.setAttribute('type', 'button')
  settingsTab.dataset.page = 'settings'
  const settingsIconEl = h('span', 'nav-icon')
  settingsIconEl.innerHTML = settingsIcon
  settingsTab.append(settingsIconEl, h('span', '', '设置'))
  const petsTab = h('button', 'tab-button', '')
  petsTab.setAttribute('type', 'button')
  petsTab.dataset.page = 'pets'
  const petsIconEl = h('span', 'nav-icon')
  petsIconEl.innerHTML = petsIcon
  petsTab.append(petsIconEl, h('span', '', '宠物'))
  const marketIcon = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>' +
    '<line x1="3" y1="6" x2="21" y2="6"/>' +
    '<path d="M16 10a4 4 0 0 1-8 0"/></svg>'
  )
  const marketTab = h('button', 'tab-button', '')
  marketTab.setAttribute('type', 'button')
  marketTab.dataset.page = 'market'
  const marketIconEl = h('span', 'nav-icon')
  marketIconEl.innerHTML = marketIcon
  marketTab.append(marketIconEl, h('span', '', '市场'))
  nav.append(settingsTab, petsTab, marketTab)

  const sidebarFooter = h('div', 'settings-sidebar-footer')
  const statusPill = h('span', 'status-pill', '连接中…')
  sidebarFooter.appendChild(statusPill)

  sidebar.append(brand, nav, sidebarFooter)

  /* ---------- 主区域 ---------- */

  const main = h('div', 'settings-main')

  const header = h('header', 'settings-header')
  const headerText = h('div', '')
  const titleEl = h('h1', '', '设置')
  const subtitleEl = p('管理桌宠、缩放、唤醒与宠物库。', '')
  const statusLine = p('连接中…', 'settings-status')
  const errorLine = p('', 'settings-error')
  errorLine.hidden = true
  headerText.append(titleEl, subtitleEl)
  header.append(headerText, statusLine, errorLine)

  /* 设置页 */
  const settingsPage = h('section', 'settings-page is-active')
  settingsPage.dataset.page = 'settings'

  // 当前宠物概览卡片（方案 A：选宠物统一去「宠物」页）
  const petSection = card('当前宠物')
  petSection.classList.add('settings-card--wide')
  const petGrid = h('div', 'pet-settings-grid')
  const preview = h('div', 'settings-pet-preview')
  const previewBox = h('div', 'pet-preview')
  const previewPet = h('div', 'pet-preview-pet')
  previewBox.appendChild(previewPet)
  preview.appendChild(previewBox)
  const previewName = h('strong', '', '未选择')
  preview.appendChild(previewName)
  // 左右结构：左侧预览，右侧说明 + 按钮（消灭全宽卡右侧大片空白）
  const petOverview = h('div', 'pet-overview')
  const petOverviewText = h('div', 'pet-overview-text')
  petOverviewText.appendChild(p('当前桌宠会跟随任务状态在桌面活动。', 'setting-hint'))
  petOverviewText.appendChild(p('选择或浏览宠物库，请到「宠物」页面。', 'setting-hint'))
  const petChooseButton = h('button', 'file-button primary-action', '去宠物页选择')
  petChooseButton.setAttribute('type', 'button')
  petChooseButton.addEventListener('click', () => setPage('pets'))
  petOverview.append(petOverviewText, petChooseButton)
  petGrid.append(preview, petOverview)
  petSection.append(petGrid)

  // 选中宠物的实时动画预览（DOM 渲染，复用桌宠渲染器）
  const previewRenderer = createDomPetRenderer(previewPet)
  previewRenderer.setState('idle')
  previewRenderer.setScale(0.6)
  previewRenderer.start()

  // 完全加载后点击预览宠物：一次播放下一个动作，循环播放。
  previewPet.addEventListener('click', () => {
    if (!previewPet.classList.contains('is-loaded')) return
    previewRenderer.playNextAnimation()
  })

  // 缩放卡片
  const zoomSection = card('缩放')
  const zoomRow = h('div', 'zoom-row')
  const zoomSlider = document.createElement('input')
  zoomSlider.type = 'range'
  zoomSlider.min = String(ZOOM_MIN)
  zoomSlider.max = String(ZOOM_MAX)
  zoomSlider.step = '0.05'
  zoomSlider.className = 'zoom-slider'
  const zoomValue = h('span', 'zoom-value', '100%')
  zoomRow.append(zoomSlider, zoomValue)
  const zoomScale = h('div', 'zoom-scale')
  zoomScale.append(
    h('span', '', `${Math.round(ZOOM_MIN * 100)}%`),
    h('span', '', '100%'),
    h('span', '', `${Math.round(ZOOM_MAX * 100)}%`),
  )
  const zoomHint = p('按住 Ctrl 并在桌宠窗口滚动鼠标滚轮，也可以调整大小。', 'setting-hint')
  zoomSection.append(zoomRow, zoomScale, zoomHint)

  // 唤醒卡片
  const wakeSection = card('唤醒')
  const wakeLabel = h('label', 'wake-label')
  const wakeCheckbox = document.createElement('input')
  wakeCheckbox.type = 'checkbox'
  wakeCheckbox.className = 'wake-checkbox'
  const wakeText = h('span', '', '跟随会话自动显示 / 隐藏')
  wakeLabel.append(wakeCheckbox, wakeText)
  const wakeHint = p('关闭时宠物保持隐藏，不随任务状态出现。', 'setting-hint')
  wakeSection.append(wakeLabel, wakeHint)

  // 存储卡片（只读路径 + 复制）
  const storageSection = card('存储')
  const storageRow = h('div', 'storage-row')
  const storageIcon = h('span', 'storage-icon')
  storageIcon.innerHTML = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
  )
  const storagePath = h('div', 'storage-path', '未找到')
  const storageCopy = h('button', 'icon-button', '复制')
  storageCopy.setAttribute('type', 'button')
  storageCopy.title = '复制宠物库路径'
  storageCopy.addEventListener('click', () => {
    const text = storagePath.textContent ?? ''
    if (!text || text === '未找到') return
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text)
        .then(() => {
          storageCopy.textContent = '已复制'
          setTimeout(() => { storageCopy.textContent = '复制' }, 1200)
        })
        .catch(() => { /* 剪贴板不可用时静默 */ })
    }
  })
  storageRow.append(storageIcon, storagePath, storageCopy)
  const storageHint = p('宠物包保存在 Codex 的宠物库目录，桌宠只读不改。', 'setting-hint')
  storageSection.append(storageRow, storageHint)

  // 系统信息卡片（来源工具 + 版本合并，避免底部碎片化）
  const systemSection = card('系统信息')
  const sourcesRow = h('div', 'system-row')
  sourcesRow.appendChild(h('span', 'system-label', '来源工具'))
  const agentsList = h('ul', 'agents-list')
  const agentsEmpty = h('li', 'agents-empty', '暂无连接')
  agentsList.appendChild(agentsEmpty)
  sourcesRow.appendChild(agentsList)
  const versionRow = h('div', 'system-row')
  versionRow.appendChild(h('span', 'system-label', '版本'))
  const versionValue = h('span', 'system-value', `${APP_NAME} v${APP_VERSION} · 线协议 v${PROTOCOL_VERSION}`)
  versionRow.appendChild(versionValue)
  systemSection.append(sourcesRow, versionRow)

  settingsPage.append(
    h('div', 'settings-group-title', '桌宠'),
    petSection, zoomSection, wakeSection,
    h('div', 'settings-group-title', '系统'),
    storageSection, systemSection,
  )

  /* 宠物页 */
  const petsPage = h('section', 'settings-page')
  petsPage.dataset.page = 'pets'

  const searchbar = h('label', 'petdex-searchbar')
  searchbar.appendChild(h('span', '', '🔍'))
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = '搜索宠物（名称 / 描述 / 来源目录）'
  searchInput.className = 'petdex-search-input'
  searchbar.appendChild(searchInput)

  // 本地宠物卡片：标题行右侧放「刷新」小按钮，避免通栏按钮抢眼
  const localCard = h('section', 'settings-card')
  const localHeader = h('div', 'card-header')
  localHeader.appendChild(h('span', 'settings-section-title', '本地宠物'))
  const petRefresh = h('button', 'refresh-button', '')
  petRefresh.setAttribute('type', 'button')
  petRefresh.title = '重新扫描 ~/.codex/pets 宠物库'
  petRefresh.innerHTML = (
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>刷新'
  )
  localHeader.appendChild(petRefresh)
  const petHint = p('宠物库直接读取 Codex 的 ~/.codex/pets/，桌宠不复制、不导入、不删除。', 'setting-hint')
  const browser = h('div', 'pet-browser')
  const localList = h('div', 'pet-list')
  const previewPanel = h('div', 'pet-browser-preview')
  const previewPanelPet = h('div', 'pet-browser-preview-pet')
  const previewPanelName = h('strong', '', '')
  const previewPanelDesc = h('span', 'pet-browser-preview-desc', '')
  const previewPanelMeta = h('span', 'pet-browser-preview-meta', '')
  const previewPanelAction = h('button', 'file-button pet-browser-action', '设为桌宠')
  previewPanelAction.setAttribute('type', 'button')
  previewPanelAction.addEventListener('click', () => {
    if (browserPreviewId !== null) client.updateSettings({ selectedPetId: browserPreviewId })
  })
  previewPanel.append(previewPanelPet, previewPanelName, previewPanelDesc, previewPanelMeta, previewPanelAction)
  browser.append(localList, previewPanel)
  // 预览持久显示最近悬停的宠物：鼠标移出列表/从任何方向离开都不切换回当前宠物；
  // 只有悬停另一只宠物或目标被删除时才更新。
  localCard.append(localHeader, browser, petHint)

  /* 市场页：独立的在线宠物市场 tab（petdex.dev） */
  const marketPage = h('section', 'settings-page')
  marketPage.dataset.page = 'market'

  // 工具栏：搜索框 + 类型筛选下拉
  const marketToolbar = h('div', 'market-toolbar')
  const marketSearchbar = h('label', 'petdex-searchbar')
  marketSearchbar.appendChild(h('span', '', '🔍'))
  const marketSearch = document.createElement('input')
  marketSearch.type = 'search'
  marketSearch.placeholder = '搜索市场（名称 / 作者 / 类型）'
  marketSearch.className = 'petdex-search-input'
  marketSearchbar.appendChild(marketSearch)
  const marketKind = document.createElement('select')
  marketKind.className = 'market-kind'
  const allKindOption = document.createElement('option')
  allKindOption.value = ''
  allKindOption.textContent = '全部类型'
  marketKind.appendChild(allKindOption)
  marketToolbar.append(marketSearchbar, marketKind)

  const marketCard = h('section', 'settings-card')
  const marketHeaderRow = h('div', 'card-header')
  marketHeaderRow.appendChild(h('span', 'settings-section-title', '在线市场'))
  const marketStatus = p('', 'market-status')
  const marketList = h('div', 'market-list')
  const marketPager = h('div', 'market-pager')
  const marketPrev = h('button', 'pager-button', '‹ 上一页')
  marketPrev.setAttribute('type', 'button')
  const marketPageLabel = h('span', 'pager-label', '')
  const marketNext = h('button', 'pager-button', '下一页 ›')
  marketNext.setAttribute('type', 'button')
  marketPager.append(marketPrev, marketPageLabel, marketNext)
  const marketHint = p('宠物由 petdex.dev 提供；安装写入 ~/.codex/pets/<slug>/，可在「宠物」页选用。', 'setting-hint')
  marketCard.append(marketHeaderRow, marketStatus, marketList, marketPager, marketHint)

  marketPage.append(marketToolbar, marketCard)

  // 宠物详情弹窗（大图动画预览 + 描述 + 安装）
  const marketDetail = h('div', 'market-detail')
  marketDetail.hidden = true
  const marketDetailCard = h('div', 'market-detail-card')
  const marketDetailClose = h('button', 'market-detail-close', '✕')
  marketDetailClose.setAttribute('type', 'button')
  const marketDetailPreview = h('div', 'market-detail-preview')
  // 加载动画：蓝色方框从小到大扩张并淡出（循环），宠物数据到达后隐藏。
  const marketDetailLoading = h('div', 'market-detail-loading')
  const marketDetailPetEl = h('div', 'market-detail-pet')
  // 占位缩略图：详情数据未到达前，用已缓存的列表缩略图（sprite 首帧）即时预览，
  // 避免等待 pet.json + 完整 sprite 下载期间预览区只有加载方框。
  const marketDetailPlaceholder = h('div', 'market-detail-placeholder')
  marketDetailPlaceholder.hidden = true
  marketDetailPreview.append(marketDetailLoading, marketDetailPetEl, marketDetailPlaceholder)
  const marketDetailName = h('h3', 'market-detail-name', '')
  const marketDetailMeta = h('p', 'market-detail-meta', '')
  const marketDetailDesc = h('p', 'market-detail-desc', '')
  const marketDetailActions = h('div', 'market-detail-actions')
  const marketDetailInstall = h('button', 'file-button primary-action', '安装')
  marketDetailInstall.setAttribute('type', 'button')
  const marketDetailUninstall = h('button', 'file-button market-detail-uninstall', '卸载')
  marketDetailUninstall.setAttribute('type', 'button')
  marketDetailUninstall.hidden = true
  const marketDetailLink = document.createElement('a')
  marketDetailLink.href = 'https://petdex.dev/zh'
  marketDetailLink.target = '_blank'
  marketDetailLink.rel = 'noopener noreferrer'
  marketDetailLink.textContent = '在 petdex 查看 ›'
  marketDetailLink.className = 'market-detail-link'
  marketDetailActions.append(marketDetailInstall, marketDetailUninstall, marketDetailLink)
  marketDetailCard.append(marketDetailClose, marketDetailPreview, marketDetailName, marketDetailMeta, marketDetailDesc, marketDetailActions)
  marketDetail.appendChild(marketDetailCard)
  root.appendChild(marketDetail)

  const marketDetailRenderer = createDomPetRenderer(marketDetailPetEl)
  marketDetailRenderer.setState('idle')
  marketDetailRenderer.setScale(1.15)
  marketDetailRenderer.start()

  // 完全加载后点击详情宠物：一次播放下一个动作，循环播放（点击技能优先，
  // 未声明则轮播全部动作）。
  marketDetailPetEl.addEventListener('click', () => {
    if (!marketDetailPetEl.classList.contains('is-loaded')) return
    marketDetailRenderer.playNextAnimation()
  })

  let detailPet: MarketPet | null = null

  function updateDetailInstall(): void {    if (!detailPet) return
    const installed = isMarketInstalled(detailPet)
    const installing = installingSlugs.has(detailPet.slug)
    const uninstalling = uninstallingSlugs.has(detailPet.slug)
    ;(marketDetailInstall as HTMLButtonElement).disabled = installed || installing || uninstalling
    marketDetailInstall.textContent = installed ? '已安装' : installing ? '安装中…' : '安装'
    marketDetailUninstall.hidden = !installed
    ;(marketDetailUninstall as HTMLButtonElement).disabled = uninstalling
    marketDetailUninstall.textContent = uninstalling ? '卸载中…' : '卸载'
  }

  // 加载方框动画周期（与 CSS market-box-grow 的 1.3s 一致）。
  const MARKET_LOAD_ANIM_MS = 1300
  let marketDetailOpenedAt = 0
  let marketDetailHideTimer: ReturnType<typeof setTimeout> | null = null

  function hideMarketDetailLoading(): void {
    if (marketDetailHideTimer !== null) {
      clearTimeout(marketDetailHideTimer)
      marketDetailHideTimer = null
    }
    marketDetailLoading.hidden = true
  }

  // 打开时间戳：用于防止"打开瞬间的第二次点击"误关（双击/快速连点卡片时，
  // 第二下 click 落在刚覆盖的遮罩上会把弹窗立刻关掉）。
  let marketDetailOpenedAtMs = 0
  /** 打开后此窗口内点击遮罩不关闭（双击第二下的最小间隔）。 */
  const MARKET_DETAIL_OPEN_DEBOUNCE_MS = 350

  function openMarketDetail(pet: MarketPet): void {
    detailPet = pet
    marketDetail.hidden = false
    marketDetailOpenedAtMs = Date.now()
    marketDetailName.textContent = pet.displayName
    marketDetailMeta.textContent = [pet.kind, pet.submittedBy ? `by ${pet.submittedBy}` : ''].filter(Boolean).join(' · ') || pet.slug
    // 描述区留空；加载反馈由预览区的蓝色方框动画承担。
    marketDetailDesc.textContent = ''
    marketDetailOpenedAt = Date.now()
    if (marketDetailHideTimer !== null) {
      clearTimeout(marketDetailHideTimer)
      marketDetailHideTimer = null
    }
    marketDetailLoading.hidden = false
    updateDetailInstall()
    marketDetailRenderer.setPet(null)
    marketDetailRenderer.setSprite(null)
    // 详情数据未到达前，用已缓存的列表缩略图（sprite 首帧）作为即时占位预览；
    // 数据到达后由 setMarketPet 隐藏。
    const thumb = marketThumbCache.get(pet.slug)
    if (thumb) {
      marketDetailPlaceholder.style.backgroundImage = `url("${thumb}")`
      marketDetailPlaceholder.hidden = false
    } else {
      marketDetailPlaceholder.hidden = true
    }
    client.requestMarketPet(pet)
  }

  function closeMarketDetail(): void {
    marketDetail.hidden = true
    detailPet = null
    hideMarketDetailLoading()
    marketDetailPlaceholder.hidden = true
  }

  marketDetailClose.addEventListener('click', closeMarketDetail)
  marketDetail.addEventListener('click', (event) => {
    if (event.target !== marketDetail) return
    // 打开后极短时间内遮罩上的点击视为"双击的第二下"，忽略避免误关。
    if (Date.now() - marketDetailOpenedAtMs < MARKET_DETAIL_OPEN_DEBOUNCE_MS) return
    closeMarketDetail()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !marketDetail.hidden) closeMarketDetail()
  })

  marketDetailInstall.addEventListener('click', () => {
    if (!detailPet || installingSlugs.has(detailPet.slug) || isMarketInstalled(detailPet)) return
    installingSlugs.add(detailPet.slug)
    updateDetailInstall()
    renderMarketList()
    client.installMarketPet(detailPet)
  })

  marketDetailUninstall.addEventListener('click', () => {
    if (!detailPet || !isMarketInstalled(detailPet) || uninstallingSlugs.has(detailPet.slug)) return
    uninstallingSlugs.add(detailPet.slug)
    updateDetailInstall()
    client.uninstallMarketPet(detailPet.slug)
  })

  let marketLoading = false
  let marketSearchTimer: ReturnType<typeof setTimeout> | null = null
  let marketPets: MarketPet[] = []
  let marketCurrentPage = 1
  let marketTotal = 0
  // 下一页预取缓存：当前页缩略图加载完后，后台预取下一页列表 + 缩略图，
  // 点「下一页」时直接从缓存渲染（秒显），再继续预取再下一页。
  let prefetchedPage: number | null = null
  let prefetchedResult: { pets: MarketPet[]; total: number } | null = null
  let prefetchTarget: number | null = null
  let prefetchScheduled = false
  let prefetchWatcherTimer: ReturnType<typeof setInterval> | null = null
  const installingSlugs = new Set<string>()
  const uninstallingSlugs = new Set<string>()
  const installedSlugs = new Set<string>()
  // 缩略图懒加载：只对可见卡片请求，且每个 slug 只请求一次。
  // marketThumbCache 保存已收到的 data URL，列表重建后直接回填，避免空白。
  const marketThumbRequested = new Set<string>()
  const marketThumbCache = new Map<string, string>()
  // 生成失败后的退避重试：3s → 6s → 12s，最多 3 次；CDN 突发多是瞬时抖动。
  const marketThumbRetries = new Map<string, number>()
  const MAX_MARKET_THUMB_RETRIES = 3
  let marketThumbObserver: IntersectionObserver | null = null

  function clearPrefetch(): void {
    prefetchedPage = null
    prefetchedResult = null
    prefetchTarget = null
    prefetchScheduled = false
    if (prefetchWatcherTimer !== null) {
      clearInterval(prefetchWatcherTimer)
      prefetchWatcherTimer = null
    }
  }

  /** 当前页缩略图都加载完后触发预取下一页；5 秒兜底（个别失败不阻塞）。 */
  function schedulePrefetch(): void {
    if (prefetchScheduled) return
    const pageSize = computeMarketPageSize()
    const totalPages = Math.max(1, Math.ceil(marketTotal / pageSize))
    if (marketCurrentPage + 1 > totalPages) return
    prefetchScheduled = true
    const watchStart = Date.now()
    const check = () => {
      // 当前页所有「已请求的缩略图」都到位了（未请求的视作不阻塞）
      const allArrived = marketPets.every(
        (pet) => !marketThumbRequested.has(pet.slug) || marketThumbCache.has(pet.slug))
      const timedOut = Date.now() - watchStart > 5000
      if (allArrived || timedOut) {
        if (prefetchWatcherTimer !== null) {
          clearInterval(prefetchWatcherTimer)
          prefetchWatcherTimer = null
        }
        prefetchScheduled = false
        doPrefetch()
      }
    }
    prefetchWatcherTimer = setInterval(check, 400)
    check()
  }

  function doPrefetch(): void {
    const next = marketCurrentPage + 1
    const pageSize = computeMarketPageSize()
    const totalPages = Math.max(1, Math.ceil(marketTotal / pageSize))
    if (next > totalPages || prefetchedPage === next) return
    prefetchTarget = next
    client.requestMarketList({
      query: marketSearch.value.trim() || undefined,
      kind: marketKind.value || undefined,
      page: next,
      pageSize,
    })
  }

  /** 批量请求预取页缩略图（分批、限并发），填充客户端缓存。 */
  function requestPrefetchedThumbs(pets: MarketPet[]): void {
    let index = 0
    const fire = () => {
      const chunk = pets.slice(index, index + 6)
      index += chunk.length
      for (const pet of chunk) {
        if (!marketThumbCache.has(pet.slug) && !marketThumbRequested.has(pet.slug)) {
          marketThumbRequested.add(pet.slug)
          client.requestMarketThumb(pet)
        }
      }
      if (index < pets.length) setTimeout(fire, 250)
    }
    fire()
  }

  /** 按网格实际列数计算每页数量：列数 × 3 行，保证整页铺满（如 9 列 → 27 个）。 */
  function computeMarketPageSize(): number {
    const cols = marketColumnCount()
    return Math.min(Math.max(cols * 3, 12), 100)
  }

  function marketColumnCount(): number {
    const template = getComputedStyle(marketList).gridTemplateColumns
    const count = template.split(' ').filter(Boolean).length
    return count > 0 ? count : 6
  }

  function getThumbObserver(): IntersectionObserver | null {
    if (typeof IntersectionObserver === 'undefined') return null
    if (marketThumbObserver) return marketThumbObserver
    marketThumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        const slug = el.dataset.marketSlug ?? ''
        const pet = marketPets.find((candidate) => candidate.slug === slug)
        if (pet && !marketThumbRequested.has(slug)) {
          marketThumbRequested.add(slug)
          client.requestMarketThumb(pet)
        }
        marketThumbObserver?.unobserve(el)
      }
    }, { rootMargin: '160px' })
    return marketThumbObserver
  }

  function basenameOf(path: string): string {
    return String(path).split(/[\\/]/).filter(Boolean).pop() ?? ''
  }

  function isMarketInstalled(pet: MarketPet): boolean {
    const key = pet.slug.toLowerCase()
    if (installedSlugs.has(key)) return true
    return currentPets.some((p) =>
      p.id.toLowerCase() === key || basenameOf(p.sourceDir).toLowerCase() === key)
  }

  function requestMarket(): void {
    if (marketLoading) return
    clearPrefetch()
    marketLoading = true
    marketStatus.textContent = '加载市场中…'
    client.requestMarketList({
      query: marketSearch.value.trim() || undefined,
      kind: marketKind.value || undefined,
      page: marketCurrentPage,
      pageSize: computeMarketPageSize(),
    })
  }

  function renderMarketList(): void {
    marketList.innerHTML = ''
    // 服务端已按分页返回当前页；这里直接渲染。
    for (const pet of marketPets) {
      const cardEl = h('article', 'pet-card market-item')
      const thumb = h('div', 'pet-card-thumb')
      if (pet.spritesheetUrl) {
        // 命中缓存的 data URL 直接回填；否则标记为懒加载。
        const cached = marketThumbCache.get(pet.slug)
        if (cached) {
          applyMarketThumb(thumb, cached)
        } else {
          thumb.dataset.marketSlug = pet.slug
          getThumbObserver()?.observe(thumb)
        }
      }
      cardEl.appendChild(thumb)
      const body = h('div', 'pet-card-body')
      body.appendChild(h('strong', '', pet.displayName))
      const metaParts = [pet.kind, pet.submittedBy ? `by ${pet.submittedBy}` : ''].filter(Boolean)
      body.appendChild(h('span', '', metaParts.length > 0 ? metaParts.join(' · ') : pet.slug))
      cardEl.appendChild(body)
      const installed = isMarketInstalled(pet)
      const installing = installingSlugs.has(pet.slug)
      const action = h('button', 'pet-card-action market-install', installed ? '已安装' : installing ? '安装中' : '安装')
      action.setAttribute('type', 'button')
      ;(action as HTMLButtonElement).disabled = installed || installing
      if (!installed && !installing) {
        action.addEventListener('click', (event) => {
          event.stopPropagation()
          installingSlugs.add(pet.slug)
          renderMarketList()
          client.installMarketPet(pet)
        })
      }
      cardEl.appendChild(action)
      // 点击卡片打开详情（按钮点击已被 stopPropagation 拦截）。
      cardEl.addEventListener('click', () => openMarketDetail(pet))
      marketList.appendChild(cardEl)
    }
    if (marketPets.length === 0 && !marketLoading) {
      marketList.appendChild(h('div', 'empty-state', '没有匹配的市场宠物。'))
    }
  }

  marketKind.addEventListener('change', () => {
    marketCurrentPage = 1
    clearPrefetch()
    requestMarket()
  })

  marketSearch.addEventListener('input', () => {
    if (marketSearchTimer !== null) clearTimeout(marketSearchTimer)
    marketSearchTimer = setTimeout(() => {
      marketCurrentPage = 1
      clearPrefetch()
      requestMarket()
    }, 300)
  })

  marketPrev.addEventListener('click', () => {
    if (marketCurrentPage <= 1 || marketLoading) return
    marketCurrentPage -= 1
    requestMarket()
  })

  marketNext.addEventListener('click', () => {
    if (marketLoading) return
    const pageSize = computeMarketPageSize()
    const totalPages = Math.max(1, Math.ceil(marketTotal / pageSize))
    const next = marketCurrentPage + 1
    // 首次加载失败后（列表为空、total 为 0）：下一页按钮兼作「重试」。
    if (marketPets.length === 0 && marketTotal === 0) {
      requestMarket()
      return
    }
    // 防止越过最后一页（快速连点 / 按钮禁用状态滞后时仍会触发点击）。
    if (next > totalPages) return
    // 命中预取缓存：秒显，不再请求服务端；随后继续预取再下一页。
    if (prefetchedPage === next && prefetchedResult) {
      marketPets = prefetchedResult.pets
      marketTotal = prefetchedResult.total
      marketCurrentPage = next
      marketLoading = false
      marketStatus.textContent = `共 ${marketTotal} 个宠物`
      marketPageLabel.textContent = `第 ${marketCurrentPage} / ${totalPages} 页`
      ;(marketPrev as HTMLButtonElement).disabled = marketCurrentPage <= 1
      ;(marketNext as HTMLButtonElement).disabled = marketCurrentPage >= totalPages
      prefetchedPage = null
      prefetchedResult = null
      prefetchTarget = null
      prefetchScheduled = false
      renderMarketList()
      schedulePrefetch()
      return
    }
    marketCurrentPage += 1
    requestMarket()
  })

  // 窗口缩放改变列数时，重新请求当前页以保持整页铺满。
  let lastMarketColumns = 0
  window.addEventListener('resize', () => {
    const cols = marketColumnCount()
    if (cols !== lastMarketColumns && !marketLoading && marketPets.length > 0) {
      lastMarketColumns = cols
      requestMarket()
    }
    lastMarketColumns = cols
  })

  function setMarketPets(payload: { pets: MarketPet[]; total: number; page: number; pageSize: number; kinds: string[] }): void {
    // 预取响应：缓存下一页列表并预载缩略图，不渲染（不打断当前页）。
    if (prefetchTarget !== null && payload.page === prefetchTarget && payload.page !== marketCurrentPage) {
      prefetchedPage = payload.page
      prefetchedResult = { pets: payload.pets, total: payload.total }
      prefetchTarget = null
      requestPrefetchedThumbs(payload.pets)
      return
    }
    marketPets = payload.pets
    marketTotal = payload.total
    marketCurrentPage = payload.page
    marketLoading = false
    // 市场恢复：清除之前「市场加载失败」的错误提示（否则错误行永久挂着）。
    setError(null)
    // 填充类型筛选下拉（保留当前选中项）。
    const currentKind = marketKind.value
    marketKind.innerHTML = ''
    const allOption = document.createElement('option')
    allOption.value = ''
    allOption.textContent = '全部类型'
    marketKind.appendChild(allOption)
    for (const kind of payload.kinds ?? []) {
      const option = document.createElement('option')
      option.value = kind
      option.textContent = kind
      marketKind.appendChild(option)
    }
    if (currentKind && (payload.kinds ?? []).includes(currentKind)) marketKind.value = currentKind
    const pageSize = payload.pageSize > 0 ? payload.pageSize : computeMarketPageSize()
    const totalPages = Math.max(1, Math.ceil(marketTotal / pageSize))
    marketStatus.textContent = `共 ${marketTotal} 个宠物`
    marketPageLabel.textContent = `第 ${marketCurrentPage} / ${totalPages} 页`
    ;(marketPrev as HTMLButtonElement).disabled = marketCurrentPage <= 1
    ;(marketNext as HTMLButtonElement).disabled = marketCurrentPage >= totalPages
    renderMarketList()
    // 当前页缩略图加载完后自动预取下一页。
    schedulePrefetch()
  }

  function setMarketListError(message: string): void {
    // 预取页失败：只丢弃预取状态，不打扰当前页（状态栏仍显示当前页信息）。
    if (prefetchTarget !== null) {
      prefetchTarget = null
      prefetchScheduled = false
      return
    }
    // 当前页失败：必须复位加载态，否则 marketLoading 卡 true，
    // 后续「下一页/搜索/缩放」全被 if (marketLoading) return 拦截 → 界面假死。
    marketLoading = false
    marketStatus.textContent = '市场加载失败'
    marketPageLabel.textContent = `第 ${marketCurrentPage} / ${Math.max(1, Math.ceil(marketTotal / Math.max(computeMarketPageSize(), 1)))} 页`
    ;(marketNext as HTMLButtonElement).disabled = false // 允许再次点击（兼作重试入口）
    setError(`市场加载失败: ${message}`)
  }

  function markMarketInstalled(info: { id: string; displayName: string; sourceDir: string }): void {    const slug = basenameOf(info.sourceDir).toLowerCase()
    installedSlugs.add(slug)
    installingSlugs.delete(slug)
    renderMarketList()
    if (detailPet && detailPet.slug === slug) updateDetailInstall()
  }

  function markMarketUninstalled(payload: { slug: string }): void {
    const slug = payload.slug.toLowerCase()
    installedSlugs.delete(slug)
    uninstallingSlugs.delete(slug)
    renderMarketList()
    if (detailPet && detailPet.slug === slug) updateDetailInstall()
  }

  function applyMarketThumb(el: HTMLElement, dataUrl: string): void {
    el.style.backgroundImage = `url("${dataUrl}")`
    el.style.backgroundSize = '100% 100%'
    el.style.backgroundPosition = 'center'
    el.style.backgroundRepeat = 'no-repeat'
  }

  function setMarketThumb(payload: { slug: string; dataUrl: string }): void {
    marketThumbCache.set(payload.slug, payload.dataUrl)
    marketThumbRetries.delete(payload.slug)
    marketList.querySelectorAll<HTMLElement>('[data-market-slug]').forEach((el) => {
      if (el.dataset.marketSlug === payload.slug) applyMarketThumb(el, payload.dataUrl)
    })
  }

  function setMarketThumbError(payload: { slug: string }): void {
    const attempts = (marketThumbRetries.get(payload.slug) ?? 0) + 1
    marketThumbRetries.set(payload.slug, attempts)
    if (attempts > MAX_MARKET_THUMB_RETRIES) {
      // 重试耗尽：留空占位；解除标记，允许用户翻页/重建后再次请求。
      marketThumbRetries.delete(payload.slug)
      marketThumbRequested.delete(payload.slug)
      return
    }
    // 当前页或预取页的宠物都可重试。
    const pet = marketPets.find((candidate) => candidate.slug === payload.slug)
      ?? prefetchedResult?.pets.find((candidate) => candidate.slug === payload.slug)
    if (!pet) return
    const delay = 3000 * 2 ** (attempts - 1)
    setTimeout(() => {
      if (marketThumbCache.has(payload.slug)) return // 重试前已成功（如翻页回填）
      client.requestMarketThumb(pet)
    }, delay)
  }

  function setMarketPet(payload: { slug: string; pet: ParsedPet | null; spriteDataUrl: string | null }): void {
    if (!detailPet || detailPet.slug !== payload.slug) return
    marketDetailRenderer.setPet(payload.pet)
    marketDetailRenderer.setSprite(payload.spriteDataUrl)
    marketDetailDesc.textContent = payload.pet?.description ?? '（无描述）'
    // 完整数据（或解析兜底）到达后，隐藏缩略图占位，交由动画渲染器接管预览。
    marketDetailPlaceholder.hidden = true
    // 加载方框至少完整播放一轮再消失：数据秒到时，等动画走完剩余时间。
    const elapsed = Date.now() - marketDetailOpenedAt
    if (elapsed >= MARKET_LOAD_ANIM_MS) {
      hideMarketDetailLoading()
    } else if (marketDetailHideTimer === null) {
      marketDetailHideTimer = setTimeout(() => {
        if (detailPet) hideMarketDetailLoading()
      }, MARKET_LOAD_ANIM_MS - elapsed)
    }
  }

  petsPage.append(searchbar, localCard)

  // 宠物页"悬停预览"面板（同样复用 DOM 渲染器）
  const hoverRenderer = createDomPetRenderer(previewPanelPet)
  hoverRenderer.setState('idle')
  hoverRenderer.setScale(0.85)
  hoverRenderer.start()

  // 完全加载后点击悬停预览宠物：一次播放下一个动作，循环播放。
  previewPanelPet.addEventListener('click', () => {
    if (!previewPanelPet.classList.contains('is-loaded')) return
    hoverRenderer.playNextAnimation()
  })

  main.append(header, settingsPage, petsPage, marketPage)

  root.append(sidebar, main)

  /* ---------- 状态 ---------- */

  let currentSettings: AppStateSnapshot['settings'] | null = null
  let currentPets: AppStateSnapshot['pets'] = []
  let currentAgents: string[] = []

  function setPage(page: 'settings' | 'pets' | 'market'): void {
    settingsTab.classList.toggle('is-active', page === 'settings')
    petsTab.classList.toggle('is-active', page === 'pets')
    marketTab.classList.toggle('is-active', page === 'market')
    settingsPage.classList.toggle('is-active', page === 'settings')
    petsPage.classList.toggle('is-active', page === 'pets')
    marketPage.classList.toggle('is-active', page === 'market')
    titleEl.textContent = page === 'settings' ? '设置' : page === 'pets' ? '宠物' : '市场'
    subtitleEl.textContent = page === 'settings'
      ? '管理桌宠、缩放、唤醒与宠物库。'
      : page === 'pets'
        ? '管理本地宠物。'
        : '从 petdex.dev 发现并安装更多宠物。'
    // 切页时回到顶部，避免上一页的滚动位置把当前页开头挤到视口外。
    main.scrollTop = 0
    // 首次进入市场页时自动加载列表。
    if (page === 'market' && marketPets.length === 0 && !marketLoading) requestMarket()
  }

  settingsTab.addEventListener('click', () => setPage('settings'))
  petsTab.addEventListener('click', () => setPage('pets'))
  marketTab.addEventListener('click', () => setPage('market'))

  // 默认打开「宠物」页：设置窗口的主要用途是选宠物，配置是次要的。
  setPage('pets')

  /* ---------- 渲染 ---------- */

  // 宠物数据缓存（pet/get 响应）：预览与缩略图复用，避免重复请求。
  const petData = new Map<string, { pet: ParsedPet; spriteDataUrl: string }>()
  const requestedPetIds = new Set<string>()
  let previewPetId: string | null = null
  let duplicateNames = new Set<string>()

  function requestPetData(id: string): void {
    if (requestedPetIds.has(id)) return
    requestedPetIds.add(id)
    client.requestPet(id)
  }

  /** 把缓存的精灵首帧铺到卡片缩略图上。 */
  function applyThumbSprite(thumb: HTMLElement | null | undefined, id: string): void {
    const data = petData.get(id)
    if (!thumb || !data) return
    thumb.style.backgroundImage = `url("${data.spriteDataUrl}")`
    thumb.style.backgroundSize = '512px 576px'
    thumb.style.backgroundPosition = '0 0'
    thumb.style.backgroundRepeat = 'no-repeat'
  }

  /** 在预览区渲染指定宠物（动画）；null 表示清空。 */
  function setPreviewPet(id: string | null): void {
    previewPetId = id
    if (id === null) {
      previewRenderer.setPet(null)
      previewRenderer.setSprite(null)
      return
    }
    const data = petData.get(id)
    if (data) {
      previewRenderer.setPet(data.pet)
      previewRenderer.setSprite(data.spriteDataUrl)
    } else {
      // 数据未到：先清空，请求到达后由 setPetPayload 渲染。
      previewRenderer.setPet(null)
      previewRenderer.setSprite(null)
      requestPetData(id)
    }
  }

  /** 同名宠物集合：用于在卡片上标注来源目录，避免"三个 Itachi"混淆。 */
  function computeDuplicateNames(): Set<string> {
    const counts = new Map<string, number>()
    for (const pet of currentPets) {
      counts.set(pet.displayName, (counts.get(pet.displayName) ?? 0) + 1)
    }
    const dup = new Set<string>()
    for (const [name, count] of counts) {
      if (count > 1) dup.add(name)
    }
    return dup
  }

  /** 宠物页"悬停预览"：预览持久显示最近悬停的宠物（鼠标移出列表不回落）。 */
  let browserPreviewId: string | null = null

  function setBrowserPreview(id: string | null): void {
    // 预览的宠物已被删除时，回落到当前选中的宠物。
    if (id !== null && !currentPets.some((candidate) => candidate.id === id)) id = null
    browserPreviewId = id
    const target = id ?? currentSettings?.selectedPetId ?? null
    const pet = currentPets.find((candidate) => candidate.id === target) ?? null
    previewPanelName.textContent = pet?.displayName ?? ''
    previewPanelDesc.textContent = pet?.description ?? ''
    previewPanelDesc.title = pet?.description ?? ''
    previewPanelMeta.textContent = pet && pet.sourceDir && pet.sourceDir !== pet?.displayName
      ? `来源：${pet.sourceDir}`
      : ''
    // 「设为桌宠」按钮始终可见，作用于当前预览的宠物（已选中时禁用）；
    // 无宠物可预览时（未悬停且未选择）隐藏。
    const isCurrent = target !== null && currentSettings?.selectedPetId === target
    previewPanelAction.hidden = target === null
    ;(previewPanelAction as HTMLButtonElement).disabled = isCurrent
    previewPanelAction.textContent = isCurrent ? '已设为桌宠' : '设为桌宠'
    if (target === null) {
      hoverRenderer.setPet(null)
      hoverRenderer.setSprite(null)
      return
    }
    const data = petData.get(target)
    if (data) {
      hoverRenderer.setPet(data.pet)
      hoverRenderer.setSprite(data.spriteDataUrl)
    } else {
      hoverRenderer.setPet(null)
      hoverRenderer.setSprite(null)
      requestPetData(target)
    }
  }

  function renderPetCard(pet: AppStateSnapshot['pets'][number] | null): HTMLElement {
    const cardEl = h('article', 'pet-card')
    if (pet === null) {
      cardEl.classList.toggle('is-active', currentSettings?.selectedPetId === null)
      cardEl.appendChild(h('div', 'pet-card-thumb'))
      const body = h('div', 'pet-card-body')
      body.appendChild(h('strong', '', '不选择宠物'))
      body.appendChild(h('span', '', '隐藏桌宠上的宠物'))
      cardEl.appendChild(body)
      const action = h('button', 'pet-card-action', currentSettings?.selectedPetId === null ? '当前' : '使用')
      action.setAttribute('type', 'button')
      action.addEventListener('click', () => {
        client.updateSettings({ selectedPetId: null })
      })
      cardEl.appendChild(action)
    } else {
      const active = currentSettings?.selectedPetId === pet.id
      cardEl.classList.toggle('is-active', active)
      const thumb = h('div', 'pet-card-thumb')
      thumb.dataset.petId = pet.id
      thumb.dataset.thumb = '1'
      applyThumbSprite(thumb, pet.id)
      requestPetData(pet.id)
      // 点击缩略图：预览窗口显示该宠物并播放下一个动作（循环播放）。
      // 数据未加载完成时（is-loaded 未就绪）不播放，避免对空画布无效操作。
      thumb.addEventListener('click', (event) => {
        event.stopPropagation()
        // 预览已显示该宠物时直接轮播（不重置轮播游标，连续点击可循环所有动作）；
        // 切换到另一只宠物时先更新预览，从它的第一个动作开始。
        if (browserPreviewId !== pet.id) {
          setBrowserPreview(pet.id)
        }
        if (previewPanelPet.classList.contains('is-loaded')) {
          hoverRenderer.playNextAnimation()
        }
      })
      cardEl.appendChild(thumb)
      const body = h('div', 'pet-card-body')
      const nameRow = h('div', 'pet-card-name-row')
      nameRow.appendChild(h('strong', '', pet.displayName))
      // 同名宠物时加来源 tag，便于区分 itachi / itachi-2 / itachi-3。
      if (duplicateNames.has(pet.displayName) && pet.sourceDir && pet.sourceDir !== pet.displayName) {
        const tag = h('span', 'pet-tag', pet.sourceDir)
        tag.title = `来源目录：${pet.sourceDir}`
        nameRow.appendChild(tag)
      }
      body.appendChild(nameRow)
      const desc = h('span', '', pet.description || pet.id)
      desc.title = pet.description || pet.id
      body.appendChild(desc)
      cardEl.appendChild(body)
      const action = h('button', 'pet-card-action', active ? '当前' : '使用')
      action.setAttribute('type', 'button')
      action.addEventListener('click', () => {
        client.updateSettings({ selectedPetId: pet.id })
      })
      // 删除按钮：从本地宠物库移除该宠物。
      const deleteBtn = h('button', 'pet-card-delete', '删除')
      deleteBtn.setAttribute('type', 'button')
      deleteBtn.title = `删除「${pet.displayName}」（从本地宠物库移除）`
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        const confirmed = window.confirm(`确定删除「${pet.displayName}」吗？将从本地宠物库移除。`)
        if (!confirmed) return
        if (currentSettings?.selectedPetId === pet.id) {
          client.updateSettings({ selectedPetId: null })
        }
        const slug = basenameOf(pet.sourceDir || pet.id).toLowerCase()
        client.uninstallMarketPet(slug)
      })
      // 按钮并排一行，紧凑网格卡片下保持可点。
      const actionsRow = h('div', 'pet-card-actions')
      actionsRow.appendChild(action)
      actionsRow.appendChild(deleteBtn)
      cardEl.appendChild(actionsRow)
      cardEl.addEventListener('mouseenter', () => setBrowserPreview(pet.id))
    }
    return cardEl
  }

  function renderPetList(): void {
    localList.innerHTML = ''
    const query = searchInput.value.trim().toLowerCase()
    duplicateNames = computeDuplicateNames()

    const matches = (pet: AppStateSnapshot['pets'][number]): boolean => {
      if (!query) return true
      // P2-9：搜索覆盖名称 / 描述 / id / 来源目录。
      return [pet.displayName, pet.description, pet.id, pet.sourceDir]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    }

    const shown = currentPets.filter(matches)

    // 宠物页：全部
    if (shown.length === 0) {
      localList.appendChild(h('div', 'empty-state', query ? '没有匹配的宠物。' : '本地宠物库为空。'))
    } else {
      for (const pet of shown) localList.appendChild(renderPetCard(pet))
    }

    const selected = currentPets.find((pet) => pet.id === currentSettings?.selectedPetId)
    previewName.textContent = selected?.displayName ?? '未选择'
    const nextPreviewId = currentSettings?.selectedPetId ?? null
    if (previewPetId !== nextPreviewId) setPreviewPet(nextPreviewId)
    // 刷新宠物页预览面板：未悬停时回落到选中宠物；
    // 悬停中则重算按钮状态（例如点击「设为桌宠」后应立即变为「已设为桌宠」）。
    setBrowserPreview(browserPreviewId)
    // 宠物库变化（安装/卸载后广播 pets）时，同步详情弹窗的安装/卸载按钮状态。
    if (detailPet) updateDetailInstall()
  }

  function renderAgents(): void {
    agentsList.innerHTML = ''
    if (currentAgents.length === 0) {
      agentsList.appendChild(h('li', 'agents-empty', '暂无连接'))
      return
    }
    for (const agent of currentAgents) {
      agentsList.appendChild(h('li', 'agent-item', agent))
    }
  }

  function renderSettings(): void {
    if (currentSettings === null) return
    zoomSlider.value = String(currentSettings.zoom)
    zoomValue.textContent = `${Math.round(currentSettings.zoom * 100)}%`
    wakeCheckbox.checked = currentSettings.awake
  }

  function renderStatus(): void {
    const agents = currentAgents.length > 0 ? currentAgents.join('、') : null
    statusLine.textContent = agents !== null ? `已连接：${agents}` : '未连接来自工具'
    statusLine.classList.toggle('is-online', agents !== null)
    statusPill.textContent = agents !== null ? '已连接' : '离线'
    statusPill.classList.toggle('is-online', agents !== null)
  }

  /* ---------- 事件 ---------- */

  let lastZoomValue = 1
  let zoomTimer: ReturnType<typeof setTimeout> | null = null

  zoomSlider.addEventListener('input', () => {
    zoomValue.textContent = `${Math.round(Number(zoomSlider.value) * 100)}%`
    lastZoomValue = Number(zoomSlider.value)
    if (zoomTimer !== null) clearTimeout(zoomTimer)
    zoomTimer = setTimeout(() => {
      client.updateSettings({ zoom: lastZoomValue })
    }, 150)
  })

  wakeCheckbox.addEventListener('change', () => {
    client.updateSettings({ awake: wakeCheckbox.checked })
  })

  petRefresh.addEventListener('click', () => {
    client.reloadLibrary()
  })

  searchInput.addEventListener('input', renderPetList)

  /* ---------- 对外接口 ---------- */

  function setSettings(settings: AppStateSnapshot['settings']): void {
    currentSettings = settings
    renderSettings()
    renderPetList()
  }

  function setPets(pets: AppStateSnapshot['pets']): void {
    currentPets = pets
    renderPetList()
    // 宠物库变化（安装/卸载广播）时同步市场卡片的已安装状态与详情按钮。
    renderMarketList()
    if (detailPet) updateDetailInstall()
  }

  function setAgents(agents: string[]): void {
    currentAgents = agents
    renderAgents()
    renderStatus()
  }

  function update(state: AppStateSnapshot): void {
    currentSettings = state.settings
    currentPets = state.pets
    currentAgents = state.agents
    storagePath.textContent = state.libraryRoot || '未找到'
    renderSettings()
    renderPetList()
    renderAgents()
    renderStatus()
  }

  function setError(message: string | null): void {
    errorLine.textContent = message ?? ''
    errorLine.hidden = message === null || message === ''
    // 出错时复位进行中的卸载状态，避免按钮卡在"卸载中…"。
    if (uninstallingSlugs.size > 0) {
      uninstallingSlugs.clear()
      renderMarketList()
      updateDetailInstall()
    }
  }

  function setPetPayload(payload: { id: string; pet: ParsedPet; spriteDataUrl: string }): void {
    const { id, pet, spriteDataUrl } = payload
    petData.set(id, { pet, spriteDataUrl })
    root.querySelectorAll<HTMLElement>('[data-thumb="1"]').forEach((thumb) => {
      if (thumb.dataset.petId === id) applyThumbSprite(thumb, id)
    })
    if (id === previewPetId) {
      previewRenderer.setPet(pet)
      previewRenderer.setSprite(spriteDataUrl)
    }
    // 宠物页悬停预览：悬停中命中，或未悬停时命中选中宠物。
    const browserTarget = browserPreviewId ?? currentSettings?.selectedPetId ?? null
    if (id === browserTarget) {
      hoverRenderer.setPet(pet)
      hoverRenderer.setSprite(spriteDataUrl)
    }
  }

  const app: SettingsApp = {
    root,
    update,
    setAgents,
    setPets,
    setSettings,
    setError,
    setPetPayload,
    setMarketPets,
    setMarketListError,
    markMarketInstalled,
    markMarketUninstalled,
    setMarketThumb,
    setMarketThumbError,
    setMarketPet,
  }
  return app
}

export function createSettingsApp(root: HTMLElement, client: UiClient): SettingsApp {
  return mountSettingsApp(root, client)
}
