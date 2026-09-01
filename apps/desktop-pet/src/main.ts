import './style.css'
import { detectWindowKind } from './window-kind.js'
import { createDomPetRenderer } from './dom-pet-renderer.js'
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

const kind = detectWindowKind(window.location.search)
const appEl = document.querySelector<HTMLElement>('#app')
const content = document.querySelector<HTMLElement>('#window-content')

appEl?.classList.add(kind === 'settings' ? 'shell--settings' : kind === 'tray' ? 'shell--tray' : 'shell--pet')
document.body.classList.add(kind === 'settings' ? 'settings-window' : kind === 'tray' ? 'tray-window' : 'pet-window')
document.title = kind === 'settings' ? '桌宠设置' : kind === 'tray' ? '活动' : '桌宠'

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
      trayToggle.title = trayExpanded ? '收起活动列表' : '展开活动列表'
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
      renderTrayItems(trayBox, trayItems, (agent, sessionId) => {
        client.openTrayItem(agent, sessionId, 'tray')
      })
    }

    function applyTray(activities: TrayItemSnapshot[]): void {
      const next = activities ?? []
      const hadAny = trayItems.length > 0
      trayItems = next
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

    if (stage) {
      stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        pressOnPet = event.target === petEl
        pointerDownAt = { x: event.clientX, y: event.clientY }
        dragStarted = false
        if (typeof stage.setPointerCapture === 'function') {
          try { stage.setPointerCapture(event.pointerId) } catch { /* ignore */ }
        }
      })
      stage.addEventListener('pointermove', (event) => {
        if (pointerDownAt === null || dragStarted) return
        const dx = event.clientX - pointerDownAt.x
        const dy = event.clientY - pointerDownAt.y
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
          dragStarted = true
          const win = currentTauriWindow()
          if (win) {
            void win.startDragging().catch(() => { /* browser dev / unsupported */ })
          }
        }
      })
      stage.addEventListener('pointerup', () => {
        const shouldClick = !dragStarted && pressOnPet
        pointerDownAt = null
        dragStarted = false
        pressOnPet = false
        if (shouldClick) {
          // 点击一次播放下一个动作：优先宠物包声明的点击技能，
          // 未声明时轮播全部动作（idle/running/waving/jumping/...）。
          renderer.playNextAnimation()
        }
      })
      stage.addEventListener('pointercancel', () => {
        pointerDownAt = null
        dragStarted = false
        pressOnPet = false
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

    function applySettings(settings: AppStateSnapshot['settings']): void {
      const nextPet = settings.selectedPetId
      if (nextPet !== selectedPetId) {
        selectedPetId = nextPet
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
    }

    function applyActivity(activity: ActivitySnapshot): void {
      // 气泡功能已移除：只保留宠物动画状态跟随（气泡文案不再渲染）。
      lastActivityState = activity.displayState || 'idle'
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
          }
        },
        onError(message) {
          // 状态胶囊已移除；连接错误仅记录
          console.error('[desktop-pet] 连接错误：', message)
        },
        onStatus(connected) {
          if (!connected) console.warn('[desktop-pet] 正在连接桌宠服务…')
        },
      },
    })

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
        onMarketInstalled(info) {
          app?.markMarketInstalled(info)
        },
        onMarketUninstalled(payload) {
          app?.markMarketUninstalled(payload)
        },
        onMarketThumb(payload) {
          app?.setMarketThumb(payload)
        },
        onMarketPet(payload) {
          app?.setMarketPet(payload)
        },
        onError(message) {
          app?.setError(message)
        },
        onStatus(connected) {
          if (!connected) app?.setError('无法连接桌宠服务，设置窗处于离线显示')
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
 * 托盘保持打开（便于连续切换会话）。关闭按钮隐藏本窗口。
 */
function mountTrayWindow(): void {
  if (!content) return

  const root = document.createElement('div')
  root.className = 'tray-window-root'

  const header = document.createElement('div')
  header.className = 'tray-window-header'
  const title = document.createElement('span')
  title.className = 'tray-window-title'
  const count = document.createElement('span')
  count.className = 'tray-count'
  count.textContent = '0'
  title.append('活动 (', count, ')')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'tray-window-close'
  close.title = '关闭'
  close.textContent = '✕'
  header.append(title, close)

  const list = document.createElement('div')
  list.className = 'tray-window-list'

  root.append(header, list)
  content.append(root)

  close.addEventListener('click', () => {
    if (isTauri()) void invoke('set_tray_window_visible', { visible: false })
  })

  function showEmpty(text: string): void {
    list.innerHTML = ''
    const empty = document.createElement('div')
    empty.className = 'tray-window-empty'
    empty.textContent = text
    list.append(empty)
  }

  const client = createUiClient({
    handlers: {
      onState(state) {
        apply(state.tray ?? state.activities ?? [])
      },
      onStateSync({ activities, tray }) {
        apply(tray ?? activities ?? [])
      },
      onError(message) {
        showEmpty(`连接错误：${message}`)
      },
      onStatus(connected) {
        if (!connected) showEmpty('正在连接桌宠服务…')
      },
    },
  })

  function apply(items: TrayItemSnapshot[]): void {
    const listItems = items ?? []
    count.textContent = String(listItems.length)
    if (listItems.length === 0) {
      showEmpty('暂无活动')
      return
    }
    renderTrayItems(list, listItems, (agent, sessionId) => {
      // 标记已读 + 打开 DSH 会话；托盘窗口保持打开
      client.openTrayItem(agent, sessionId, 'tray')
    })
  }

  ;(window as any).__desktopPetTray = { client, apply }
}
