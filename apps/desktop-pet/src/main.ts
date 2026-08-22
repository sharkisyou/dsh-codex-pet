import './style.css'
import { detectWindowKind } from './window-kind.js'
import { createPetRenderer } from './renderer.js'
import { createUiClient, type UiClient } from './ui-client.js'
import { mountSettingsApp } from './settings-app.js'
import type { AppStateSnapshot, ActivitySnapshot } from './controller.js'
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
    `
    const canvas = document.querySelector<HTMLCanvasElement>('#pet-canvas')
    const status = document.querySelector<HTMLParagraphElement>('#pet-status')
    const stage = document.querySelector<HTMLElement>('#pet-stage')
    if (canvas) {
      const renderer = createPetRenderer(canvas, { frameRate: 80 })
      renderer.setState('idle')
      renderer.setBubble('idle')
      renderer.start()

      let selectedPetId: string | null = null
      let zoom = 1
      let awake = true

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
        if (status) {
          status.textContent = state.agents.length > 0
            ? `来源：${state.agents.join('、')}`
            : '等待桥接连接'
        }
      }

      const client: UiClient = createUiClient({
        handlers: {
          onState: applyState,
          onStateSync({ settings, agents, activity }) {
            applySettings(settings)
            applyActivity(activity)
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
