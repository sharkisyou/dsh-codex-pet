import './style.css'
import { detectWindowKind } from './window-kind.js'
import { bubbleText } from './renderer.js'
import { createDomPetRenderer } from './dom-pet-renderer.js'
import { mountPetShell, type PetShell } from './pet-shell.js'
import { createUiClient, type UiClient } from './ui-client.js'
import { mountSettingsApp } from './settings-app.js'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi'
import type { AppStateSnapshot, ActivitySnapshot, TrayItemSnapshot } from './controller.js'
import { type ParsedPet } from '@yshark/pet-core'

const kind = detectWindowKind(window.location.search)
const appEl = document.querySelector<HTMLElement>('#app')
const content = document.querySelector<HTMLElement>('#window-content')

appEl?.classList.add(kind === 'settings' ? 'shell--settings' : 'shell--pet')
document.body.classList.add(kind === 'settings' ? 'settings-window' : 'pet-window')
document.title = kind === 'settings' ? '桌宠设置' : '桌宠'

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)
}

function currentTauriWindow(): ReturnType<typeof getCurrentWindow> | null {
  return isTauri() ? getCurrentWindow() : null
}

if (kind === 'pet') {
  const petEl = document.querySelector<HTMLElement>('#pet')
  const status = document.querySelector<HTMLParagraphElement>('#pet-status')
  const stage = document.querySelector<HTMLElement>('#pet-stage')
  const bubbleEl = document.querySelector<HTMLElement>('#speech-bubble')
  const contextMenuEl = document.querySelector<HTMLElement>('#pet-context-menu')
  const trayToggle = document.querySelector<HTMLButtonElement>('#activity-tray-toggle')
  const trayBox = document.querySelector<HTMLElement>('#activity-tray')
  if (petEl) {
    const renderer = createDomPetRenderer(petEl)
    renderer.setState('idle')
    renderer.start()

    function updateStatus(text: string): void {
      if (status) status.textContent = text
    }

    let selectedPetId: string | null = null
    let zoom = 1.2
    let awake = true
    let trayItems: TrayItemSnapshot[] = []
    let trayOpen = false
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
      const win = await WebviewWindow.getByLabel('settings')
      if (win) {
        await win.show()
        await win.setFocus()
      }
    }

    function hidePetWindow(): void {
      const win = currentTauriWindow()
      if (win) void win.hide()
    }

    const shell: PetShell = mountPetShell({
      element: petEl,
      bubbleEl: bubbleEl ?? document.createElement('div'),
      contextMenuEl,
      getScale: () => zoom,
      setScale: (next) => {
        zoom = next
        applyZoom()
      },
      renderer,
      onOpenSettings: openSettingsWindow,
      onHide: hidePetWindow,
      onBubbleHide: () => renderer.setState(lastActivityState),
    })

    /* ---------- 活动托盘 ---------- */

    function trayStateLabel(state: string): string {
      switch (state) {
        case 'waiting': return '需要输入'
        case 'blocked':
        case 'failed': return '受阻'
        case 'ready': return '就绪'
        case 'running':
        case 'working': return '运行中'
        default: return '空闲'
      }
    }

    function renderTray(): void {
      if (!trayBox || !trayToggle) return
      trayBox.innerHTML = ''
      if (trayItems.length === 0) {
        trayToggle.hidden = true
        trayBox.hidden = true
        trayOpen = false
        return
      }
      trayToggle.hidden = false
      trayToggle.textContent = `活动 (${trayItems.length})`
      if (!trayOpen) {
        trayBox.hidden = true
        return
      }
      trayBox.hidden = false
      for (const item of trayItems) {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'activity-tray-item' + (item.acknowledged ? ' read' : ' unread')
        row.dataset.agent = item.agent ?? ''
        row.dataset.sessionId = item.sessionId
        row.title = item.title ?? item.sessionId

        const title = document.createElement('span')
        title.className = 'activity-tray-title'
        title.textContent = item.title || item.sessionId

        const meta = document.createElement('span')
        meta.className = 'activity-tray-meta'
        meta.textContent = `${item.agent ?? '未知来源'} · ${trayStateLabel(item.state)}`

        row.append(title, meta)
        row.addEventListener('click', () => {
          if (item.agent === null) return
          client.openTrayItem(item.agent, item.sessionId, 'tray')
          trayOpen = false
          renderTray()
        })
        trayBox.appendChild(row)
      }
    }

    function applyTray(activities: TrayItemSnapshot[]): void {
      trayItems = activities ?? []
      renderTray()
    }

    if (trayToggle) {
      trayToggle.addEventListener('click', () => {
        trayOpen = !trayOpen
        renderTray()
      })
    }

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
          renderer.playNextClickSkill()
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
      lastActivityState = activity.displayState || 'idle'
      renderer.setState(lastActivityState)
      const key = activity.bubbleKey
      if (key && key !== 'idle') {
        shell.showBubble({
          title: activity.agent ?? '桌宠',
          message: bubbleText(key, activity.bubbleParams),
          state: lastActivityState,
        })
      }
    }

    function applyState(state: AppStateSnapshot): void {
      applySettings(state.settings)
      applyActivity(state.activity)
      applyTray(state.tray ?? state.activities ?? [])
      updateStatus(state.agents.length > 0
        ? `来源：${state.agents.join('、')}`
        : '等待桥接连接')
    }

    const client: UiClient = createUiClient({
      handlers: {
        onState: applyState,
        onStateSync({ settings, agents, activity, activities, tray }) {
          applySettings(settings)
          applyActivity(activity)
          applyTray(tray ?? activities ?? [])
          updateStatus(agents.length > 0
            ? `来源：${agents.join('、')}`
            : '等待桥接连接')
        },
        onPet({ id, pet, spriteDataUrl }) {
          if (id === selectedPetId) {
            renderer.setPet(pet as ParsedPet)
            renderer.setSprite(spriteDataUrl)
            if (status) status.textContent = '浏览器预览 · 已连接'
          }
        },
        onError(message) {
          updateStatus(`连接错误：${message}`)
        },
        onStatus(connected) {
          if (!connected) updateStatus('正在连接桌宠服务…')
        },
      },
    })

    void attachPositionPersistence()

    // Expose for debugging / tests.
    ;(window as any).__desktopPet = { client, renderer, shell, applyState }
  }
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
