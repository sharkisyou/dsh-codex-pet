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
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

import {
  APP_VERSION,
  DARK_THEME_IDS,
  LANGUAGE_IDS,
  LIGHT_THEME_IDS,
  THEME_MODES,
  ZOOM_MIN,
  ZOOM_MAX,
  type DarkThemeId,
  type LanguageId,
  type LightThemeId,
  type ThemeId,
  type ThemeMode,
} from './app-constants.js'
import { currentLanguage, resolveLanguage, setLanguage, t } from './i18n.js'
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

/** 静态文案节点：绑定 i18n key，语言切换时由 applyLanguage 统一重写。 */
function i18n<T extends HTMLElement>(el: T, key: string): T {
  el.dataset.i18n = key
  el.textContent = t(key)
  return el
}

function p(text: string, className?: string): HTMLParagraphElement {
  const el = document.createElement('p')
  if (className) el.className = className
  el.textContent = text
  return el
}

/** 静态文案段落（i18n key）。 */
function pt(key: string, className?: string): HTMLParagraphElement {
  return i18n(p(''), key)
}

/** 卡片工厂：titleKey 为 i18n key。 */
function card(titleKey: string): HTMLElement {
  const section = h('section', 'settings-card')
  section.appendChild(i18n(h('div', 'settings-section-title'), titleKey))
  return section
}

export function mountSettingsApp(root: HTMLElement, client: UiClient): SettingsApp {
  root.innerHTML = ''
  root.className = 'settings-root'
  // 挂载时先按系统语言取词；持久化的语言选择随 settings 到达后再应用。
  setLanguage(resolveLanguage(null))

  /* ---------- 侧边栏 ---------- */

  const sidebar = h('aside', 'settings-sidebar')

  const brand = h('div', 'settings-brand')
  const brandMark = h('span', 'brand-mark', '宠')
  const petMeta = h('div', 'pet-meta')
  petMeta.appendChild(i18n(h('strong'), 'app.name'))
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
  settingsTab.append(settingsIconEl, i18n(h('span'), 'nav.settings'))
  const petsTab = h('button', 'tab-button', '')
  petsTab.setAttribute('type', 'button')
  petsTab.dataset.page = 'pets'
  const petsIconEl = h('span', 'nav-icon')
  petsIconEl.innerHTML = petsIcon
  petsTab.append(petsIconEl, i18n(h('span'), 'nav.pets'))
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
  marketTab.append(marketIconEl, i18n(h('span'), 'nav.market'))
  nav.append(settingsTab, petsTab, marketTab)

  const sidebarFooter = h('div', 'settings-sidebar-footer')
  const statusPill = h('span', 'status-pill', t('status.connecting'))
  sidebarFooter.appendChild(statusPill)

  sidebar.append(brand, nav, sidebarFooter)

  /* ---------- 主区域 ---------- */

  const main = h('div', 'settings-main')

  const header = h('header', 'settings-header')
  const headerText = h('div', '')
  const titleEl = h('h1', '', t('page.pets.title'))
  const subtitleEl = p(t('page.pets.subtitle'), '')
  const statusLine = p(t('status.connecting'), 'settings-status')
  const errorLine = p('', 'settings-error')
  errorLine.hidden = true
  headerText.append(titleEl, subtitleEl)
  header.append(headerText, statusLine, errorLine)

  /* 设置页 */
  const settingsPage = h('section', 'settings-page is-active')
  settingsPage.dataset.page = 'settings'

  // 当前宠物概览卡片（方案 A：选宠物统一去「宠物」页）
  const petSection = card('card.pet')
  petSection.classList.add('settings-card--wide')
  const petGrid = h('div', 'pet-settings-grid')
  const preview = h('div', 'settings-pet-preview')
  const previewBox = h('div', 'pet-preview')
  const previewPet = h('div', 'pet-preview-pet')
  previewBox.appendChild(previewPet)
  preview.appendChild(previewBox)
  const previewName = h('strong', '', t('pet.unselected'))
  preview.appendChild(previewName)
  // 左右结构：左侧预览，右侧说明 + 按钮（消灭全宽卡右侧大片空白）
  const petOverview = h('div', 'pet-overview')
  const petOverviewText = h('div', 'pet-overview-text')
  petOverviewText.appendChild(pt('pet.hint1', 'setting-hint'))
  petOverviewText.appendChild(pt('pet.hint2', 'setting-hint'))
  const petChooseButton = i18n(h('button', 'file-button primary-action'), 'pet.choose')
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
  const zoomSection = card('card.zoom')
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
  const zoomHint = pt('zoom.hint', 'setting-hint')
  zoomSection.append(zoomRow, zoomScale, zoomHint)

  // 唤醒卡片
  const wakeSection = card('card.wake')
  const wakeLabel = h('label', 'wake-label')
  const wakeCheckbox = document.createElement('input')
  wakeCheckbox.type = 'checkbox'
  wakeCheckbox.className = 'wake-checkbox'
  wakeLabel.append(wakeCheckbox, i18n(h('span'), 'wake.label'))
  const wakeHint = pt('wake.hint', 'setting-hint')
  wakeSection.append(wakeLabel, wakeHint)

  // 主题卡片（外观组）：模式三选一 + 深色侧/浅色侧主题下拉
  const themeSection = card('card.theme')
  themeSection.classList.add('settings-card--wide')
  const themePicker = h('div', 'theme-picker')

  const themeModeBlock = h('div', 'theme-block')
  themeModeBlock.appendChild(i18n(h('span', 'theme-label'), 'theme.mode'))
  const themeModeGroup = h('div', 'theme-mode')
  const themeModeButtons = new Map<ThemeMode, HTMLElement>()
  for (const mode of THEME_MODES) {
    const button = i18n(h('button', 'theme-mode-btn'), `theme.mode.${mode}`)
    button.setAttribute('type', 'button')
    button.addEventListener('click', () => {
      if (currentSettings?.themeMode === mode) return
      client.updateSettings({ themeMode: mode })
    })
    themeModeButtons.set(mode, button)
    themeModeGroup.appendChild(button)
  }
  themeModeBlock.appendChild(themeModeGroup)

  const darkThemeBlock = h('div', 'theme-block')
  darkThemeBlock.appendChild(i18n(h('span', 'theme-label'), 'theme.dark'))
  const darkThemeSelect = document.createElement('select')
  darkThemeSelect.className = 'theme-select'
  for (const id of DARK_THEME_IDS) {
    const option = i18n(document.createElement('option') as HTMLOptionElement, `theme.dark.${id}`)
    option.value = id
    darkThemeSelect.appendChild(option)
  }
  darkThemeSelect.addEventListener('change', () => {
    client.updateSettings({ darkTheme: darkThemeSelect.value as DarkThemeId })
  })
  darkThemeBlock.appendChild(darkThemeSelect)

  const lightThemeBlock = h('div', 'theme-block')
  lightThemeBlock.appendChild(i18n(h('span', 'theme-label'), 'theme.light'))
  const lightThemeSelect = document.createElement('select')
  lightThemeSelect.className = 'theme-select'
  for (const id of LIGHT_THEME_IDS) {
    const option = i18n(document.createElement('option') as HTMLOptionElement, `theme.light.${id}`)
    option.value = id
    lightThemeSelect.appendChild(option)
  }
  lightThemeSelect.addEventListener('change', () => {
    client.updateSettings({ lightTheme: lightThemeSelect.value as LightThemeId })
  })
  lightThemeBlock.appendChild(lightThemeSelect)

  themePicker.append(themeModeBlock, darkThemeBlock, lightThemeBlock)
  themeSection.append(themePicker)

  // 语言卡片（外观组）：系统默认 / 中文 / English
  const languageSection = card('card.language')
  languageSection.classList.add('settings-card--wide')
  const languageButtons = new Map<LanguageId, HTMLElement>()
  const languageGroup = h('div', 'theme-mode theme-mode--language')
  const LANG_LABEL_KEYS: Record<LanguageId, string> = { system: 'lang.system', zh: 'lang.zh', en: 'lang.en' }
  for (const id of LANGUAGE_IDS) {
    const button = i18n(h('button', 'theme-mode-btn'), LANG_LABEL_KEYS[id])
    button.setAttribute('type', 'button')
    button.addEventListener('click', () => {
      if (currentSettings?.language === id) return
      client.updateSettings({ language: id })
    })
    languageButtons.set(id, button)
    languageGroup.appendChild(button)
  }
  languageSection.appendChild(languageGroup)

  // 存储卡片（只读路径 + 复制）
  const storageSection = card('card.storage')
  const storageRow = h('div', 'storage-row')
  const storageIcon = h('span', 'storage-icon')
  storageIcon.innerHTML = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
  )
  const storagePath = h('div', 'storage-path', t('storage.notFound'))
  // 基础文案挂 data-i18n；点击后的「已复制」反馈由 click 处理临时覆盖。
  const storageCopy = i18n(h('button', 'icon-button'), 'storage.copy')
  storageCopy.setAttribute('type', 'button')
  storageCopy.title = t('storage.copy')
  storageCopy.addEventListener('click', () => {
    const text = storagePath.textContent ?? ''
    if (!text || text === t('storage.notFound')) return
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text)
        .then(() => {
          storageCopy.textContent = t('storage.copied')
          setTimeout(() => { storageCopy.textContent = t('storage.copy') }, 1200)
        })
        .catch(() => { /* 剪贴板不可用时静默 */ })
    }
  })
  storageRow.append(storageIcon, storagePath, storageCopy)
  storageSection.append(storageRow, pt('storage.hint', 'setting-hint'))

  // 系统信息卡片（来源工具 + 版本合并，避免底部碎片化）
  const systemSection = card('card.system')
  const sourcesRow = h('div', 'system-row')
  sourcesRow.appendChild(i18n(h('span', 'system-label'), 'system.source'))
  const agentsList = h('ul', 'agents-list')
  const agentsEmpty = h('li', 'agents-empty', t('system.noAgents'))
  agentsList.appendChild(agentsEmpty)
  sourcesRow.appendChild(agentsList)
  const versionRow = h('div', 'system-row')
  versionRow.appendChild(i18n(h('span', 'system-label'), 'system.version'))
  const versionValue = h('span', 'system-value', `${t('app.name')} v${APP_VERSION} · ${t('system.protocol')} v${PROTOCOL_VERSION}`)
  versionRow.appendChild(versionValue)
  systemSection.append(sourcesRow, versionRow)

  settingsPage.append(
    i18n(h('div', 'settings-group-title'), 'group.pet'),
    petSection, zoomSection, wakeSection,
    i18n(h('div', 'settings-group-title'), 'group.appearance'),
    themeSection, languageSection,
    i18n(h('div', 'settings-group-title'), 'group.system'),
    storageSection, systemSection,
  )

  /* 宠物页 */
  const petsPage = h('section', 'settings-page')
  petsPage.dataset.page = 'pets'

  const searchbar = h('label', 'petdex-searchbar')
  searchbar.appendChild(h('span', '', '🔍'))
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = t('search.pets.placeholder')
  searchInput.className = 'petdex-search-input'
  searchInput.dataset.i18nPlaceholder = 'search.pets.placeholder'
  searchbar.appendChild(searchInput)

  // 本地宠物卡片：标题行右侧放「刷新」小按钮，避免通栏按钮抢眼
  const localCard = h('section', 'settings-card')
  const localHeader = h('div', 'card-header')
  localHeader.appendChild(i18n(h('span', 'settings-section-title'), 'pets.local'))
  const petRefresh = h('button', 'refresh-button', '')
  petRefresh.setAttribute('type', 'button')
  petRefresh.title = t('pets.refresh')
  petRefresh.innerHTML = (
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'
  )
  petRefresh.appendChild(i18n(h('span'), 'pets.refresh'))
  localHeader.appendChild(petRefresh)
  const petHint = pt('pets.hint', 'setting-hint')
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
  marketSearch.placeholder = t('search.market.placeholder')
  marketSearch.className = 'petdex-search-input'
  marketSearch.dataset.i18nPlaceholder = 'search.market.placeholder'
  marketSearchbar.appendChild(marketSearch)
  const marketKind = document.createElement('select')
  marketKind.className = 'market-kind'
  const allKindOption = document.createElement('option')
  allKindOption.value = ''
  allKindOption.textContent = t('market.allKinds')
  marketKind.appendChild(allKindOption)
  marketToolbar.append(marketSearchbar, marketKind)

  const marketCard = h('section', 'settings-card')
  const marketHeaderRow = h('div', 'card-header')
  marketHeaderRow.appendChild(i18n(h('span', 'settings-section-title'), 'market.online'))
  const marketStatus = p('', 'market-status')
  const marketList = h('div', 'market-list')
  const marketPager = h('div', 'market-pager')
  const marketPrev = i18n(h('button', 'pager-button'), 'market.prev')
  marketPrev.setAttribute('type', 'button')
  const marketPageLabel = h('span', 'pager-label', '')
  const marketNext = i18n(h('button', 'pager-button'), 'market.next')
  marketNext.setAttribute('type', 'button')
  marketPager.append(marketPrev, marketPageLabel, marketNext)
  marketCard.append(marketHeaderRow, marketStatus, marketList, marketPager, pt('market.hint', 'setting-hint'))

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
  marketDetailLink.className = 'market-detail-link'
  marketDetailLink.dataset.i18n = 'market.viewOnPetdex'
  marketDetailLink.textContent = t('market.viewOnPetdex')
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
    marketDetailInstall.textContent = installed ? t('market.installed') : installing ? t('market.installing') : t('market.install')
    marketDetailUninstall.hidden = !installed
    ;(marketDetailUninstall as HTMLButtonElement).disabled = uninstalling
    marketDetailUninstall.textContent = uninstalling ? t('market.uninstalling') : t('market.uninstall')
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
    // 链接指到该宠物的官方详情页（构建时的 href 是首页兜底，每次打开重设）。
    marketDetailLink.href = `https://petdex.dev/zh/pets/${pet.slug}`
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
    marketStatus.textContent = t('market.loading')
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
      const action = h('button', 'pet-card-action market-install',
        installed ? t('market.installed') : installing ? t('market.installing') : t('market.install'))
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
      marketList.appendChild(h('div', 'empty-state', t('market.empty')))
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
    marketStatus.textContent = t('market.count', { n: marketTotal })
    marketPageLabel.textContent = t('market.page', { x: marketCurrentPage, y: totalPages })
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
    marketStatus.textContent = t('market.failed')
    marketPageLabel.textContent = t('market.page', {
      x: marketCurrentPage,
      y: Math.max(1, Math.ceil(marketTotal / Math.max(computeMarketPageSize(), 1))),
    })
    ;(marketNext as HTMLButtonElement).disabled = false // 允许再次点击（兼作重试入口）
    setError(t('market.loadFailedBody', { message }))
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
    marketDetailDesc.textContent = payload.pet?.description ?? t('market.noDesc')
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
  let libraryRootText: string | null = null

  let currentPage: 'settings' | 'pets' | 'market' = 'pets'

  function setPage(page: 'settings' | 'pets' | 'market'): void {
    currentPage = page
    settingsTab.classList.toggle('is-active', page === 'settings')
    petsTab.classList.toggle('is-active', page === 'pets')
    marketTab.classList.toggle('is-active', page === 'market')
    settingsPage.classList.toggle('is-active', page === 'settings')
    petsPage.classList.toggle('is-active', page === 'pets')
    marketPage.classList.toggle('is-active', page === 'market')
    titleEl.textContent = t(page === 'settings' ? 'page.settings.title' : page === 'pets' ? 'page.pets.title' : 'page.market.title')
    subtitleEl.textContent = t(page === 'settings'
      ? 'page.settings.subtitle'
      : page === 'pets'
        ? 'page.pets.subtitle'
        : 'page.market.subtitle')
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

  /* ---------- 主题应用 ---------- */

  // 「系统」模式跟随操作系统深浅色；OS 切换时无需刷新，直接重算 data-theme。
  const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)')

  function resolveThemeId(settings: AppStateSnapshot['settings'] | null): ThemeId {
    const mode = settings?.themeMode ?? 'system'
    const dark = settings?.darkTheme ?? 'graphite'
    const light = settings?.lightTheme ?? 'classic'
    if (mode === 'dark') return dark
    if (mode === 'light') return light
    return systemDarkQuery.matches ? dark : light
  }

  function applyTheme(): void {
    const settings = currentSettings
    const mode = settings?.themeMode ?? 'system'
    document.body.dataset.theme = resolveThemeId(settings)
    // 模式固定某一侧时，另一侧的选择先记住、暂不生效。
    darkThemeBlock.classList.toggle('is-dimmed', mode === 'light')
    lightThemeBlock.classList.toggle('is-dimmed', mode === 'dark')
    for (const [modeKey, button] of themeModeButtons) {
      button.classList.toggle('is-active', modeKey === mode)
    }
    darkThemeSelect.value = settings?.darkTheme ?? 'graphite'
    lightThemeSelect.value = settings?.lightTheme ?? 'classic'
    syncNativeBackground()
  }

  /**
   * 最大化/调整窗口大小时的白屏根治：html 根背景必须不透明。
   * 本页样式与宠物窗共用（html/body 透明供宠物窗透出桌面），透明渲染帧在
   * WebView2 resize 时，未提交的暴露区呈纯白且无视 DefaultBackgroundColor
   * （品红判别实验实测）；帧不透明时暴露区直接显示 html 底色（≤1 帧生效）。
   * html 在 body 外层拿不到 body[data-theme] 的 token，用解析好的 hex 写入。
   */
  function syncNativeBackground(): void {
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--bg-window)'
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).backgroundColor
    probe.remove()
    const parts = rgb.match(/\d+/g)
    if (!parts || parts.length < 3) return
    const hex = `#${parts.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`
    document.documentElement.style.backgroundColor = hex
    if (!('__TAURI_INTERNALS__' in window)) return
    void getCurrentWebviewWindow().setBackgroundColor(hex).catch((error) => {
      // 权限缺失（capabilities 未放行 set-background-color）时这里能看见告警。
      console.warn('[desktop-pet] 设置窗口原生背景色失败:', error)
    })
  }

  systemDarkQuery.addEventListener('change', () => applyTheme())

  /* ---------- 语言应用 ---------- */

  function applyLanguage(): void {
    const lang = resolveLanguage(currentSettings?.language)
    setLanguage(lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = t('title.settings')
    // 静态文案：data-i18n / data-i18n-placeholder 标记的节点统一重写。
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n as string)
    })
    root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder as string)
    })
    // 「全部类型」选项不在 data-i18n 覆盖内（其余类型选项为服务端数据）。
    const allKindOption = marketKind.querySelector<HTMLOptionElement>('option[value=""]')
    if (allKindOption) allKindOption.textContent = t('market.allKinds')
    // 控件状态：主题模式/主题选择/语言选择的高亮与置灰。
    for (const [mode, button] of themeModeButtons) {
      button.classList.toggle('is-active', (currentSettings?.themeMode ?? 'system') === mode)
    }
    darkThemeSelect.value = currentSettings?.darkTheme ?? 'graphite'
    lightThemeSelect.value = currentSettings?.lightTheme ?? 'classic'
    darkThemeBlock.classList.toggle('is-dimmed', (currentSettings?.themeMode ?? 'system') === 'light')
    lightThemeBlock.classList.toggle('is-dimmed', (currentSettings?.themeMode ?? 'system') === 'dark')
    for (const [id, button] of languageButtons) {
      button.classList.toggle('is-active', (currentSettings?.language ?? 'system') === id)
    }
    // 动态文案：由各渲染函数按当前语言重算。
    setPage(currentPage)
    renderStatus()
    renderAgents()
    renderPetList()
    renderMarketList()
    updateDetailInstall()
    storagePath.textContent = libraryRootText ?? t('storage.notFound')
    versionValue.textContent = `${t('app.name')} v${APP_VERSION} · ${t('system.protocol')} v${PROTOCOL_VERSION}`
    applyTheme()
  }

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
      ? t('pet.sourcePrefix', { dir: pet.sourceDir })
      : ''
    // 「设为桌宠」按钮始终可见，作用于当前预览的宠物（已选中时禁用）；
    // 无宠物可预览时（未悬停且未选择）隐藏。
    const isCurrent = target !== null && currentSettings?.selectedPetId === target
    previewPanelAction.hidden = target === null
    ;(previewPanelAction as HTMLButtonElement).disabled = isCurrent
    previewPanelAction.textContent = isCurrent ? t('pet.setAsDone') : t('pet.setAs')
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
      body.appendChild(h('strong', '', t('pet.noneCard')))
      body.appendChild(h('span', '', t('pet.noneCardHint')))
      cardEl.appendChild(body)
      const action = h('button', 'pet-card-action', currentSettings?.selectedPetId === null ? t('pet.current') : t('pet.use'))
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
      const action = h('button', 'pet-card-action', active ? t('pet.current') : t('pet.use'))
      action.setAttribute('type', 'button')
      action.addEventListener('click', () => {
        client.updateSettings({ selectedPetId: pet.id })
      })
      // 删除按钮：从本地宠物库移除该宠物。
      const deleteBtn = h('button', 'pet-card-delete', t('pet.delete'))
      deleteBtn.setAttribute('type', 'button')
      deleteBtn.title = t('pet.deleteConfirm', { name: pet.displayName })
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        const confirmed = window.confirm(t('pet.deleteConfirm', { name: pet.displayName }))
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
      localList.appendChild(h('div', 'empty-state', query ? t('pets.noMatch') : t('pets.empty')))
    } else {
      for (const pet of shown) localList.appendChild(renderPetCard(pet))
    }

    const selected = currentPets.find((pet) => pet.id === currentSettings?.selectedPetId)
    previewName.textContent = selected?.displayName ?? t('pet.unselected')
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
      agentsList.appendChild(h('li', 'agents-empty', t('system.noAgents')))
      return
    }
    for (const agent of currentAgents) {
      agentsList.appendChild(h('li', 'agent-item', agent))
    }
  }

  function renderSettings(): void {
    applyTheme()
    // 语言变化（含首次拿到持久化设置）时整体重写文案；applyLanguage 内部
    // 会 setLanguage，之后 resolveLanguage 与 currentLanguage 一致，不会循环。
    if (resolveLanguage(currentSettings?.language) !== currentLanguage()) {
      applyLanguage()
      return
    }
    if (currentSettings === null) return
    zoomSlider.value = String(currentSettings.zoom)
    zoomValue.textContent = `${Math.round(currentSettings.zoom * 100)}%`
    wakeCheckbox.checked = currentSettings.awake
  }

  function renderStatus(): void {
    const agents = currentAgents.length > 0 ? currentAgents.join('、') : null
    statusLine.textContent = agents !== null ? t('status.connectedTo', { agents }) : t('status.noTools')
    statusLine.classList.toggle('is-online', agents !== null)
    statusPill.textContent = agents !== null ? t('status.online') : t('status.offline')
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
    libraryRootText = state.libraryRoot || null
    storagePath.textContent = state.libraryRoot || t('storage.notFound')
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
  // 挂收尾时统一应用一次语言（重写静态文案 + 重算动态文案）。
  // 不能提前：renderPetList 等依赖的 petData 等常量在渲染段才初始化。
  applyLanguage()
  return app
}

export function createSettingsApp(root: HTMLElement, client: UiClient): SettingsApp {
  return mountSettingsApp(root, client)
}
