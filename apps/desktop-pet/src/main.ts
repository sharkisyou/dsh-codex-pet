import './style.css'
import { detectWindowKind } from './window-kind.js'
import { createPetRenderer } from './renderer.js'
import { createUiClient, type UiClient } from './ui-client.js'
import { mountSettingsApp } from './settings-app.js'
import type { AppStateSnapshot, ActivitySnapshot, TrayItemSnapshot } from './controller.js'
import type { ParsedPet } from '@yshark/pet-core'

const kind = detectWindowKind(window.location.search)
const label = document.querySelector<HTMLParagraphElement>('#window-label')

if (label) {
  label.textContent = kind === 'settings'
    ? 'Settings window'
    : 'Pet window'
}

document.title = kind === 'settings' ? 'Pet Settings' : 'Desktop Pet'

if (kind === 'pet') {
  const content = document.querySelector<HTMLElement>('#window-content')
  if (content) {
    content.innerHTML = `
      <div class="pet-stage" id="pet-stage">
        <canvas id="pet-canvas" width="240" height="240"></canvas>
        <p id="pet-status" class="pet-status">连接中…</p>
      </div>
      <div class="activity-tray-wrap" id="activity-tray-wrap">
        <button id="activity-tray-toggle" class="activity-tray-toggle" type="button" hidden>活动</button>
        <div id="activity-tray" class="activity-tray" hidden></div>
      </div>
    `
    const canvas = document.querySelector<HTMLCanvasElement>('#pet-canvas')
    const status = document.querySelector<HTMLParagraphElement>('#pet-status')
    const stage = document.querySelector<HTMLElement>('#pet-stage')
    const trayToggle = document.querySelector<HTMLButtonElement>('#activity-tray-toggle')
    const trayBox = document.querySelector<HTMLElement>('#activity-tray')
    if (canvas) {
      const renderer = createPetRenderer(canvas, { frameRate: 80 })
      renderer.setState('idle')
      renderer.setBubble('idle')
      renderer.start()

      let selectedPetId: string | null = null
      let zoom = 1
      let awake = true
      let trayItems: TrayItemSnapshot[] = []
      let trayOpen = false

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

      function applyZoom(): void {
        if (!canvas) return
        const size = Math.round(240 * zoom)
        canvas.style.width = `${size}px`
        canvas.style.height = `${size}px`
      }

      function applyAwake(): void {
        if (stage) stage.style.visibility = awake ? 'visible' : 'hidden'
      }

      function applySettings(settings: AppStateSnapshot['settings']): void {
        const nextPet = settings.selectedPetId
        if (nextPet !== selectedPetId) {
          selectedPetId = nextPet
          if (selectedPetId === null) {
            renderer.setPet(null)
            renderer.setSprite(null)
          } else {
            client.requestPet(selectedPetId)
          }
        }
        zoom = settings.zoom
        awake = settings.awake
        applyZoom()
        applyAwake()
      }

      function applyActivity(activity: ActivitySnapshot): void {
        renderer.setState(activity.displayState || 'idle')
        renderer.setBubble(activity.bubbleKey, activity.bubbleParams)
      }

      function applyState(state: AppStateSnapshot): void {
        applySettings(state.settings)
        applyActivity(state.activity)
        applyTray(state.tray ?? state.activities ?? [])
        if (status) {
          status.textContent = state.agents.length > 0
            ? `来源：${state.agents.join('、')}`
            : '等待桥接连接'
        }
      }

      const client: UiClient = createUiClient({
        handlers: {
          onState: applyState,
          onStateSync({ settings, agents, activity, activities, tray }) {
            applySettings(settings)
            applyActivity(activity)
            applyTray(tray ?? activities ?? [])
            if (status) {
              status.textContent = agents.length > 0
                ? `来源：${agents.join('、')}`
                : '等待桥接连接'
            }
          },
          onPet({ id, pet, spriteDataUrl }) {
            if (id === selectedPetId) {
              renderer.setPet(pet as ParsedPet)
              renderer.setSprite(spriteDataUrl)
            }
          },
          onError(message) {
            if (status) status.textContent = `连接错误：${message}`
          },
          onStatus(connected) {
            if (status && !connected) status.textContent = '正在连接桌宠服务…'
          },
        },
      })

      // Expose for debugging / tests.
      ;(window as any).__desktopPet = { client, renderer, applyState }
    }
  }
} else if (kind === 'settings') {
  const content = document.querySelector<HTMLElement>('#window-content')
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
