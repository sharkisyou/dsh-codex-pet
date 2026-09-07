import './style.css'
import { detectWindowKind } from './window-kind.js'
import { CELL_HEIGHT, CELL_WIDTH, createDomPetRenderer } from './dom-pet-renderer.js'
import { mountPetShell, type PetShell } from './pet-shell.js'
import { createUiClient, type UiClient } from './ui-client.js'
import { mountSettingsApp } from './settings-app.js'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi'
import type { AppStateSnapshot, ActivitySnapshot, TrayItemSnapshot } from './controller.js'
import { type ParsedPet } from '@yshark/pet-core'
import { renderTrayItems } from './tray-ui.js'
import { petLog } from './pet-log.js'
import { resolveLanguage, setLanguage, t } from './i18n.js'

const kind = detectWindowKind(window.location.search)
const appEl = document.querySelector<HTMLElement>('#app')
const content = document.querySelector<HTMLElement>('#window-content')

appEl?.classList.add(kind === 'settings' ? 'shell--settings' : kind === 'tray' ? 'shell--tray' : 'shell--pet')
document.body.classList.add(kind === 'settings' ? 'settings-window' : kind === 'tray' ? 'tray-window' : 'pet-window')
// 窗口标题先按系统语言；持久化语言选择随后由各窗口在设置同步时应用。
setLanguage(resolveLanguage(null))
document.title = kind === 'settings' ? t('title.settings') : kind === 'tray' ? t('title.tray') : t('title.pet')

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)
}

function currentTauriWindow(): ReturnType<typeof getCurrentWindow> | null {
  return isTauri() ? getCurrentWindow() : null
}

/** 显示/隐藏独立托盘窗口（Tauri）；非 Tauri 环境静默失败。 */
async function setTrayWindowVisible(visible: boolean): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await invoke<boolean>('set_tray_window_visible', { visible })
  } catch {
    return false
  }
}

/** 切换独立托盘窗口（Tauri）。 */
async function toggleTrayWindow(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await invoke<boolean>('toggle_tray_window')
  } catch {
    return false
  }
}

/** 托盘打开会话后，把承载 DSH GUI 的浏览器窗口还原并置顶（会话切换在网页内，
 *  但浏览器可能被最小化/置于后台）。非 Tauri 环境静默。 */
async function focusDshGuiWindow(title?: string): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('focus_dsh_gui', { title: title ?? null })
  } catch {
    // 聚焦失败不影响会话打开
  }
}

if (kind === 'pet') {
  const petEl = document.querySelector<HTMLElement>('#pet')
  const stage = document.querySelector<HTMLElement>('#pet-stage')
  const contextMenuEl = document.querySelector<HTMLElement>('#pet-context-menu')
  const trayToggle = document.querySelector<HTMLButtonElement>('#activity-tray-toggle')
  const trayBox = document.querySelector<HTMLElement>('#activity-tray')
  if (petEl) {
    const renderer = createDomPetRenderer(petEl)
    renderer.setState('idle')
    renderer.start()

    let selectedPetId: string | null = null
    let zoom = 1.2
    let awake = true
    let trayItems: TrayItemSnapshot[] = []
    /** 托盘是否展开：Tauri = 独立托盘窗口可见；浏览器 = 内嵌列表展开。 */
    let trayExpanded = false
    let positionRestored = false
    let positionSaveTimer: ReturnType<typeof setTimeout> | null = null
    let lastActivityState = 'idle'
    /** 待机形态状态：精灵未加载时显示剪影；断连时角标亮起（已加载宠物的断连保留宠物）。 */
    const standbyEl = document.querySelector<HTMLElement>('#pet-standby')
    const standbySilhouette = standbyEl?.querySelector<HTMLElement>('.pet-standby-silhouette')
    const STANDBY_SILHOUETTE_KEY = 'pet-standby-silhouette'
    let petHasSprite = false
    let wsConnected = false

    // 恢复上次缓存的剪影（当前宠物的形状）；从未成功加载过则用内置的 Dimo 兜底剪影。
    try {
      const cachedSilhouette = localStorage.getItem(STANDBY_SILHOUETTE_KEY)
      if (standbySilhouette && cachedSilhouette) {
        standbySilhouette.style.backgroundImage = `url("${cachedSilhouette}")`
      }
    } catch {
      // localStorage 不可用时静默走兜底剪影
    }

    /** 从精灵图首帧提取单色剪影缓存到 localStorage，供下次启动的待机形态使用。 */
    function cacheStandbySilhouette(spriteDataUrl: string): void {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = CELL_WIDTH
          canvas.height = CELL_HEIGHT
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (!ctx) return
          ctx.drawImage(img, 0, 0, CELL_WIDTH, CELL_HEIGHT, 0, 0, CELL_WIDTH, CELL_HEIGHT)
          const frame = ctx.getImageData(0, 0, CELL_WIDTH, CELL_HEIGHT)
          const px = frame.data
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] === 0) continue
            px[i] = 148 // #94a3b8 灰蓝，与内置 Dimo 兜底剪影同色；保留原 alpha 让边缘平滑
            px[i + 1] = 163
            px[i + 2] = 184
          }
          ctx.putImageData(frame, 0, 0)
          localStorage.setItem(STANDBY_SILHOUETTE_KEY, canvas.toDataURL('image/png'))
          if (standbySilhouette) {
            standbySilhouette.style.backgroundImage = `url("${canvas.toDataURL('image/png')}")`
          }
        } catch {
          // 剪影缓存失败不影响宠物显示
        }
      }
      img.src = spriteDataUrl
    }

    function syncPetStandby(): void {
      if (!standbyEl) return
      const show = !petHasSprite
      standbyEl.classList.toggle('show', show)
      const badge = standbyEl.querySelector<HTMLElement>('.pet-standby-badge')
      if (badge) {
        badge.hidden = wsConnected
        badge.textContent = t('pet.offline')
      }
    }

    /* ---------- 桌宠外壳交互（气泡 / 悬停 / 缩放 / 移动动画 / 右键菜单） ---------- */

    async function openSettingsWindow(): Promise<void> {
      if (!isTauri()) {
        // 浏览器预览：设置页是同一前端里的 ?window=settings 路由，
        // 在新标签页打开即可。
        window.open('/?window=settings', '_blank')
        return
      }
      // Tauri：走 Rust 命令打开设置窗口——已存在则显示聚焦，
      // 已被用户关闭则重新创建（右键菜单/托盘都能再次打开）。
      try {
        await invoke('open_settings_window')
      } catch {
        // 命令失败时静默（例如窗口创建被平台拒绝）。
      }
    }

    function hidePetWindow(): void {
      const win = currentTauriWindow()
      if (win) void win.hide()
    }

    const shell: PetShell = mountPetShell({
      element: petEl,
      // 气泡功能已移除；pet-shell 仍要求一个 bubbleEl，传一个无用的离屏 div。
      bubbleEl: document.createElement('div'),
      contextMenuEl,
      getScale: () => zoom,
      setScale: (next) => {
        zoom = next
        applyZoom()
      },
      renderer,
      onOpenSettings: openSettingsWindow,
      onHide: hidePetWindow,
    })

    /* ---------- 活动托盘（独立托盘窗口；浏览器降级为内嵌列表） ---------- */

    /** 展开/收起托盘：Tauri 走独立窗口命令，浏览器切内嵌列表。 */
    async function expandTray(expand: boolean): Promise<void> {
      if (isTauri()) {
        trayExpanded = await setTrayWindowVisible(expand)
      } else {
        trayExpanded = expand
      }
      renderTray()
    }

    function renderTray(): void {
      if (!trayBox || !trayToggle) return
      if (trayItems.length === 0) {
        // 无活动会话：角标消失
        trayToggle.hidden = true
        trayBox.hidden = true
        return
      }
      // 有活动会话：角标常驻（数量 + 三角）；收起时向下三角，展开时向上三角
      trayToggle.hidden = false
      trayToggle.classList.toggle('open', trayExpanded)
      trayToggle.title = trayExpanded ? t('tray.collapse') : t('tray.expand')
      const count = trayToggle.querySelector<HTMLElement>('.tray-count')
      if (count) count.textContent = String(trayItems.length)
      if (isTauri()) {
        // 独立托盘窗口模式：宠物窗口内不渲染列表，只留角标
        trayBox.hidden = true
        return
      }
      // 浏览器降级：内嵌列表（点击项保持展开，便于连续切换会话）
      if (!trayExpanded) {
        trayBox.hidden = true
        return
      }
    trayBox.hidden = false
    renderTrayItems(trayBox, trayItems, (agent, sessionId, _reason, title) => {
      client.openTrayItem(agent, sessionId, 'tray')
      void focusDshGuiWindow(title)
    })
    }

    function applyTray(activities: TrayItemSnapshot[]): void {
      const next = activities ?? []
      const hadAny = trayItems.length > 0
      trayItems = next
      petLog('ui', 'applyTray', { count: next.length, items: next.map((t) => ({ sid: t.sessionId, state: t.state, rem: t.reminder })) })
      if (next.length === 0) {
        // 无活动：收起（独立窗口隐藏 / 内嵌列表收起）
        trayExpanded = false
        if (isTauri()) void setTrayWindowVisible(false)
        renderTray()
        return
      }
      // 无活动 → 有活动：自动展开一次；之后保持用户的开/关选择
      if (!hadAny) {
        void expandTray(true)
        return
      }
      renderTray()
    }

    if (trayToggle) {
      trayToggle.addEventListener('click', () => {
        // Tauri：切换独立托盘窗口；浏览器：切换内嵌列表
        if (isTauri()) {
          void toggleTrayWindow().then((visible) => {
            trayExpanded = visible
            renderTray()
          })
        } else {
          trayExpanded = !trayExpanded
          renderTray()
        }
      })
    }

    // 托盘区（角标 + 内嵌列表降级）不参与宠物窗的窗口拖动：阻止 pointerdown
    // 冒泡到 stage，否则 stage 的 setPointerCapture 会把真实点击的 click
    // 重定向到 stage，导致角标开/关失效（真实鼠标点击才触发）。
    const trayWrap = document.querySelector<HTMLElement>('#activity-tray-wrap')
    trayWrap?.addEventListener('pointerdown', (event) => event.stopPropagation())

    /* ---------- 窗口位置持久化 ---------- */

    function saveWindowPosition(x: number, y: number): void {
      if (positionSaveTimer !== null) clearTimeout(positionSaveTimer)
      positionSaveTimer = setTimeout(() => {
        positionSaveTimer = null
        client.updateSettings({ windowX: x, windowY: y })
      }, 300)
    }

    async function attachPositionPersistence(): Promise<void> {
      const win = currentTauriWindow()
      if (!win) return
      try {
        await win.onMoved(({ payload }) => {
          shell.onWindowMoved(payload.x)
          if (!positionRestored) return
          saveWindowPosition(payload.x, payload.y)
        })
      } catch {
        // Tauri window events are unavailable outside a Tauri webview.
      }
    }

    /* ---------- 窗口拖动 + 点击技能 ---------- */

    let pressOnPet = false
    let pointerDownAt: { x: number; y: number } | null = null
    let dragStarted = false
    const DRAG_THRESHOLD_PX = 5
    // 手动拖动：锚定按下时的窗口物理坐标与光标屏幕坐标（CSS px），
    // move 时按增量 setPosition。不用 startDragging()——原生标题栏拖动循环
    // 会触发 Aero Shake（快速来回甩动宠物 → Windows 最小化其他所有窗口，
    // 2026-09-07 实测浏览器被最小化）与边缘贴靠/顶部最大化，对桌宠都不适用。
    // 注：跨不同 DPI 显示器拖动时增量换算会有轻微漂移，松手重抓即恢复。
    let dragAnchor: { winX: number; winY: number; screenX: number; screenY: number } | null = null
    let dragLatest: { screenX: number; screenY: number } | null = null
    let dragFramePending = false

    function applyDragFrame(): void {
      dragFramePending = false
      if (!dragStarted || dragAnchor === null || dragLatest === null) return
      const win = currentTauriWindow()
      if (!win) return
      const dpr = window.devicePixelRatio || 1
      const x = Math.round(dragAnchor.winX + (dragLatest.screenX - dragAnchor.screenX) * dpr)
      const y = Math.round(dragAnchor.winY + (dragLatest.screenY - dragAnchor.screenY) * dpr)
      void win.setPosition(new PhysicalPosition(x, y)).catch(() => { /* 拖动跟随失败静默 */ })
    }

    if (stage) {
      stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        pressOnPet = event.target === petEl
        pointerDownAt = { x: event.clientX, y: event.clientY }
        dragStarted = false
        dragAnchor = null
        dragLatest = null
        const win = currentTauriWindow()
        if (win) {
          void win.outerPosition()
            .then((pos) => {
              // 按下尚未结束且未开始拖动时锚定窗口位置
              if (pointerDownAt !== null && !dragStarted) {
                dragAnchor = { winX: pos.x, winY: pos.y, screenX: event.screenX, screenY: event.screenY }
              }
            })
            .catch(() => { /* 取不到窗口位置则本次放弃拖动 */ })
        }
        if (typeof stage.setPointerCapture === 'function') {
          try { stage.setPointerCapture(event.pointerId) } catch { /* ignore */ }
        }
      })
      stage.addEventListener('pointermove', (event) => {
        if (pointerDownAt === null) return
        if (!dragStarted) {
          if (dragAnchor === null) return // 窗口位置锚点未就绪，先不判定
          const dx = event.clientX - pointerDownAt.x
          const dy = event.clientY - pointerDownAt.y
          if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
            dragStarted = true
          } else {
            return
          }
        }
        dragLatest = { screenX: event.screenX, screenY: event.screenY }
        if (!dragFramePending) {
          dragFramePending = true
          requestAnimationFrame(applyDragFrame)
        }
      })
      const endDrag = (): void => {
        const shouldClick = !dragStarted && pressOnPet
        pointerDownAt = null
        dragStarted = false
        pressOnPet = false
        dragAnchor = null
        dragLatest = null
        if (shouldClick) {
          // 点击一次播放下一个动作：优先宠物包声明的点击技能，
          // 未声明时轮播全部动作（idle/running/waving/jumping/...）。
          renderer.playNextAnimation()
        }
      }
      stage.addEventListener('pointerup', endDrag)
      stage.addEventListener('pointercancel', () => {
        // 仅重置状态，不触发点击动作（保持原行为）
        pointerDownAt = null
        dragStarted = false
        pressOnPet = false
        dragAnchor = null
        dragLatest = null
      })
    }

    /* ---------- 缩放 ---------- */

    function applyZoom(): void {
      if (!petEl) return
      // DOM 宠物尺寸由渲染器按 192×208 基准缩放。
      renderer.setScale(zoom)
      const win = currentTauriWindow()
      if (win) {
        // 透明宠物窗口按 CodexPetDesk 布局缩放：宽度容纳宠物+留白，
        // 高度容纳宠物 + 顶部气泡区域。
        const petWidth = Math.round(192 * zoom)
        const petHeight = Math.round(208 * zoom)
        const width = Math.max(276, petWidth + 16)
        const height = petHeight + 16 + 82
        void win.setSize(new LogicalSize(width, height)).catch(() => {
          // Ignore in browser dev or when the platform rejects the resize.
        })
      }
    }

    function applyAwake(): void {
      if (stage) stage.style.visibility = awake ? 'visible' : 'hidden'
    }

    /* ---------- 状态应用 ---------- */

    /** 宠物窗文案随语言设置：右键菜单 + 角标提示 + 窗口标题。 */
    function applyPetWindowLanguage(language: AppStateSnapshot['settings']['language'] | undefined): void {
      setLanguage(resolveLanguage(language))
      document.title = t('title.pet')
      const menuSettings = document.querySelector<HTMLButtonElement>('#pet-menu-settings')
      const menuHide = document.querySelector<HTMLButtonElement>('#pet-menu-hide')
      if (menuSettings) menuSettings.textContent = t('menu.settings')
      if (menuHide) menuHide.textContent = t('menu.hide')
      if (trayToggle) trayToggle.title = trayExpanded ? t('tray.collapse') : t('tray.expand')
      const standbyBadge = standbyEl?.querySelector<HTMLElement>('.pet-standby-badge')
      if (standbyBadge) standbyBadge.textContent = t('pet.offline')
    }

    function applySettings(settings: AppStateSnapshot['settings']): void {
      const nextPet = settings.selectedPetId
      if (nextPet !== selectedPetId) {
        selectedPetId = nextPet
        // 换宠/清空期间视为未就绪：旧精灵已清、新精灵未到。
        petHasSprite = false
        syncPetStandby()
        if (selectedPetId === null) {
          renderer.setPet(null)
          renderer.setSprite(null)
        } else {
          // 切换宠物时立即清掉旧图，避免新图加载完成前残留旧宠物像素。
          renderer.setPet(null)
          renderer.setSprite(null)
          client.requestPet(selectedPetId)
        }
      }
      zoom = settings.zoom
      awake = settings.awake
      applyZoom()
      applyAwake()
      if (!positionRestored) {
        positionRestored = true
        if (settings.windowX != null && settings.windowY != null) {
          const win = currentTauriWindow()
          if (win) {
            void win.setPosition(new PhysicalPosition(settings.windowX, settings.windowY)).catch(() => {
              // Ignore restore failures (e.g. position no longer valid).
            })
          }
        }
      }
      applyPetWindowLanguage(settings.language)
    }

    function applyActivity(activity: ActivitySnapshot): void {
      // 气泡功能已移除：只保留宠物动画状态跟随（气泡文案不再渲染）。
      lastActivityState = activity.displayState || 'idle'
      petLog('ui', 'applyActivity', { displayState: lastActivityState, state: activity.state, sessionId: activity.sessionId })
      renderer.setState(lastActivityState)
    }

    function applyState(state: AppStateSnapshot): void {
      applySettings(state.settings)
      applyActivity(state.activity)
      applyTray(state.tray ?? state.activities ?? [])
    }

    const client: UiClient = createUiClient({
      handlers: {
        onState: applyState,
        onStateSync({ settings, agents, activity, activities, tray }) {
          applySettings(settings)
          applyActivity(activity)
          applyTray(tray ?? activities ?? [])
        },
        onPet({ id, pet, spriteDataUrl }) {
          if (id === selectedPetId) {
            renderer.setPet(pet as ParsedPet)
            renderer.setSprite(spriteDataUrl)
            petHasSprite = Boolean(spriteDataUrl)
            if (spriteDataUrl) cacheStandbySilhouette(spriteDataUrl)
            syncPetStandby()
          }
        },
        onError(message) {
          // 状态胶囊已移除；连接错误仅记录
          console.error('[desktop-pet] 连接错误：', message)
        },
        onStatus(connected) {
          wsConnected = connected
          if (!connected) console.warn('[desktop-pet] 正在连接桌宠服务…')
          syncPetStandby()
        },
      },
    })

    // 启动即同步一次：服务端不在时页面加载即为待机形态（剪影 + 未连接角标）。
    syncPetStandby()

    void attachPositionPersistence()

    // 启动时同步独立托盘窗口的真实可见性（宠物窗热刷新/重启时保持角标箭头一致）。
    if (isTauri()) {
      try {
        void WebviewWindow.getByLabel('tray').then((win) => {
          if (win) {
            void win.isVisible().then((visible) => {
              trayExpanded = visible
              renderTray()
            })
          }
        })
      } catch {
        // ignore
      }
    }

    // Expose for debugging / tests.
    ;(window as any).__desktopPet = { client, renderer, shell, applyState }

    // 挂载后先按系统语言应用一次宠物窗文案；持久化选择随设置同步覆盖。
    applyPetWindowLanguage(undefined)
  }
} else if (kind === 'tray') {
  void mountTrayWindow()
} else if (kind === 'settings') {
  if (content) {
    let app: ReturnType<typeof mountSettingsApp> | null = null
    const client = createUiClient({
      handlers: {
        onState(state) {
          app?.update(state)
        },
        onStateSync({ settings, agents }) {
          app?.setSettings(settings)
          app?.setAgents(agents)
        },
        onPets(pets) {
          app?.setPets(pets)
        },
        onPet({ id, pet, spriteDataUrl }) {
          app?.setPetPayload({ id, pet, spriteDataUrl })
        },
        onMarketList(payload) {
          app?.setMarketPets(payload)
        },
        onMarketListError(message) {
          app?.setMarketListError(message)
        },
        onMarketInstalled(info) {
          app?.markMarketInstalled(info)
        },
        onMarketUninstalled(payload) {
          app?.markMarketUninstalled(payload)
        },
        onMarketThumb(payload) {
          app?.setMarketThumb(payload)
        },
        onMarketThumbError(payload) {
          app?.setMarketThumbError(payload)
        },
        onMarketPet(payload) {
          app?.setMarketPet(payload)
        },
        onError(message) {
          app?.setError(message)
        },
        onStatus(connected) {
          if (!connected) app?.setError(t('error.offline'))
          else app?.setError(null)
        },
      },
    })
    app = mountSettingsApp(content, client)
    ;(window as any).__desktopPetSettings = { client, app }
  }
}

/**
 * 独立活动托盘窗口（Tauri 的 label=tray 窗口）。
 * 渲染活动列表：标题 + 来源 + 状态标签，未读蓝点；点击项标记已读并打开 DSH 会话，
 * 托盘保持打开（便于连续切换会话）。通过宠物窗角标收起本窗口。
 */
function mountTrayWindow(): void {
  if (!content) return

  const root = document.createElement('div')
  root.className = 'tray-window-root'

  const header = document.createElement('div')
  header.className = 'tray-window-header'
  const title = document.createElement('span')
  title.className = 'tray-window-title'
  const titleText = document.createElement('span')
  titleText.textContent = t('tray.title')
  const count = document.createElement('span')
  count.className = 'tray-count'
  count.textContent = '0'
  title.append(titleText, ' (', count, ')')
  header.append(title)

  const list = document.createElement('div')
  list.className = 'tray-window-list'

  root.append(header, list)
  content.append(root)

  function showEmpty(text: string): void {
    list.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'tray-window-empty'
    empty.textContent = text
    list.append(empty)
  }

  // 托盘窗口高度随活动会话数量增减：测量内容高度后调 resize_tray_window。
  // 测量按实际布局精确计算（header + 列表上下 padding + 各项高 + 项间距），
  // 并留 4px 余量，避免窗口比内容矮几像素而出现滚动条。
  let fitTimer: ReturnType<typeof setTimeout> | null = null
  function fitHeight(): void {
    if (!isTauri()) return
    if (fitTimer !== null) clearTimeout(fitTimer)
    fitTimer = setTimeout(() => {
      fitTimer = null
      const items = list.querySelectorAll<HTMLElement>('.activity-tray-item')
      const empty = list.querySelector<HTMLElement>('.tray-window-empty')
      const LIST_PAD = 12 // 列表上下 padding 各 6px
      const ITEM_GAP = 2
      let content = header.offsetHeight + LIST_PAD + 4
      items.forEach((item, index) => {
        content += item.offsetHeight + (index < items.length - 1 ? ITEM_GAP : 0)
      })
      if (empty) content += (empty as HTMLElement).offsetHeight + LIST_PAD
      if (content <= 0) return
      void invoke('resize_tray_window', { height: Math.round(content) })
    }, 80)
  }

  /** 托盘窗文案随语言设置：标题（空态等在 apply 内重算）。 */
  function applyTrayLanguage(language: AppStateSnapshot['settings']['language'] | undefined): void {
    setLanguage(resolveLanguage(language))
    titleText.textContent = t('tray.title')
  }

  const client = createUiClient({
    handlers: {
      onState(state) {
        applyTrayLanguage(state.settings?.language)
        apply(state.tray ?? state.activities ?? [])
      },
      onStateSync({ settings, activities, tray }) {
        applyTrayLanguage(settings?.language)
        apply(tray ?? activities ?? [])
      },
      onError(message) {
        showEmpty(t('tray.connectError', { message }))
      },
      onStatus(connected) {
        if (!connected) showEmpty(t('tray.connecting'))
      },
    },
  })

  function apply(items: TrayItemSnapshot[]): void {
    const listItems = items ?? []
    count.textContent = String(listItems.length)
    if (listItems.length === 0) {
      showEmpty(t('tray.empty'))
      fitHeight()
      return
    }
    renderTrayItems(list, listItems, (agent, sessionId, _reason, title) => {
      // 标记已读 + 打开 DSH 会话；托盘窗口保持打开
      client.openTrayItem(agent, sessionId, 'tray')
      void focusDshGuiWindow(title)
    })
    fitHeight()
  }

  ;(window as any).__desktopPetTray = { client, apply }
}
