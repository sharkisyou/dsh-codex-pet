/**
 * Settings window UI.
 *
 * Rendered inside the Tauri settings webview. It reads state from the internal
 * UI control channel, lets the user select a pet, adjust zoom, toggle wake,
 * see connected source tools, and open the external pet market.
 */

import { PROTOCOL_VERSION } from '@yshark/pet-protocol'

import {
  APP_NAME,
  APP_VERSION,
  PET_MARKET_URL,
  ZOOM_MAX,
  ZOOM_MIN,
} from './app-constants.js'
import type { AppStateSnapshot } from './controller.js'
import type { UiClient } from './ui-client.js'

export interface SettingsApp {
  readonly root: HTMLElement
  update(state: AppStateSnapshot): void
  setAgents(agents: string[]): void
  setPets(pets: AppStateSnapshot['pets']): void
  setSettings(settings: AppStateSnapshot['settings']): void
  setError(message: string | null): void
}

let lastZoomValue = 1
let zoomTimer: ReturnType<typeof setTimeout> | null = null

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

export function mountSettingsApp(root: HTMLElement, client: UiClient): SettingsApp {
  root.innerHTML = ''
  root.className = 'settings-root'

  const heading = h('h1', 'settings-title', `${APP_NAME}设置`)
  const statusLine = p('连接中…', 'settings-status')
  const errorLine = p('', 'settings-error')
  errorLine.hidden = true

  // 宠物选择
  const petSection = h('section', 'settings-section')
  petSection.appendChild(h('h2', '', '宠物'))
  const petList = h('div', 'pet-list')
  const petRefresh = h('button', 'pet-refresh', '刷新宠物库')
  ;(petRefresh as HTMLButtonElement).type = 'button'
  const petHint = p('宠物库直接读取 Codex 的 ~/.codex/pets/，桌宠不复制、不导入、不删除。', 'hint')
  petSection.append(petList, petRefresh, petHint)

  // 缩放
  const zoomSection = h('section', 'settings-section')
  zoomSection.appendChild(h('h2', '', '缩放'))
  const zoomRow = h('div', 'zoom-row')
  const zoomSlider = document.createElement('input')
  zoomSlider.type = 'range'
  zoomSlider.min = String(ZOOM_MIN)
  zoomSlider.max = String(ZOOM_MAX)
  zoomSlider.step = '0.05'
  zoomSlider.className = 'zoom-slider'
  const zoomValue = h('span', 'zoom-value', '100%')
  zoomRow.append(zoomSlider, zoomValue)
  zoomSection.appendChild(zoomRow)

  // 唤醒
  const wakeSection = h('section', 'settings-section')
  wakeSection.appendChild(h('h2', '', '唤醒'))
  const wakeLabel = h('label', 'wake-label')
  const wakeCheckbox = document.createElement('input')
  wakeCheckbox.type = 'checkbox'
  wakeCheckbox.className = 'wake-checkbox'
  const wakeText = h('span', '', '唤醒宠物（显示并跟随会话状态）')
  wakeLabel.append(wakeCheckbox, wakeText)
  wakeSection.appendChild(wakeLabel)

  // 已连接来源工具
  const agentsSection = h('section', 'settings-section')
  agentsSection.appendChild(h('h2', '', '已连接来源工具'))
  const agentsList = h('ul', 'agents-list')
  const agentsHint = p('暂无连接', 'hint')
  agentsList.appendChild(agentsHint)
  agentsSection.appendChild(agentsList)

  // 关于
  const aboutSection = h('section', 'settings-section')
  aboutSection.appendChild(h('h2', '', '关于'))
  const aboutText = p(
    `${APP_NAME} v${APP_VERSION} · 线协议 v${PROTOCOL_VERSION}`,
    'about-line',
  )
  const libraryRoot = p('宠物库路径：', 'about-line')
  const marketLink = document.createElement('a')
  marketLink.href = PET_MARKET_URL
  marketLink.target = '_blank'
  marketLink.rel = 'noopener noreferrer'
  marketLink.textContent = '打开宠物市场'
  marketLink.className = 'market-link'
  const marketHint = p('市场仅提供外部画廊入口；安装仍由 Codex 完成。', 'hint')
  aboutSection.append(aboutText, libraryRoot, marketLink, marketHint)

  root.append(heading, statusLine, errorLine, petSection, zoomSection, wakeSection, agentsSection, aboutSection)

  let currentSettings: AppStateSnapshot['settings'] | null = null
  let currentPets: AppStateSnapshot['pets'] = []
  let currentAgents: string[] = []

  function renderPetList(): void {
    petList.innerHTML = ''
    const noneButton = h('button', 'pet-item' + (currentSettings?.selectedPetId === null ? ' active' : ''), '未选择')
    ;(noneButton as HTMLButtonElement).type = 'button'
    noneButton.addEventListener('click', () => {
      client.updateSettings({ selectedPetId: null })
    })
    petList.appendChild(noneButton)

    for (const pet of currentPets) {
      const item = h('button', 'pet-item' + (currentSettings?.selectedPetId === pet.id ? ' active' : ''), pet.displayName)
      ;(item as HTMLButtonElement).type = 'button'
      item.title = pet.description || pet.id
      item.dataset.petId = pet.id
      item.addEventListener('click', () => {
        client.updateSettings({ selectedPetId: pet.id })
      })
      petList.appendChild(item)
    }
  }

  function renderAgents(): void {
    agentsList.innerHTML = ''
    if (currentAgents.length === 0) {
      const empty = h('li', 'agents-empty', '暂无连接')
      agentsList.appendChild(empty)
      return
    }
    for (const agent of currentAgents) {
      agentsList.appendChild(h('li', 'agent-item', agent))
    }
  }

  function renderSettings(): void {
    if (currentSettings === null) return
    petList.querySelectorAll('.pet-item').forEach((el) => {
      const id = (el as HTMLElement).dataset.petId ?? null
      el.classList.toggle('active', (id ?? null) === currentSettings!.selectedPetId)
    })
    zoomSlider.value = String(currentSettings.zoom)
    zoomValue.textContent = `${Math.round(currentSettings.zoom * 100)}%`
    wakeCheckbox.checked = currentSettings.awake
  }

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

  function setSettings(settings: AppStateSnapshot['settings']): void {
    currentSettings = settings
    renderSettings()
  }

  function setPets(pets: AppStateSnapshot['pets']): void {
    currentPets = pets
    renderPetList()
  }

  function setAgents(agents: string[]): void {
    currentAgents = agents
    renderAgents()
    statusLine.textContent = agents.length > 0
      ? `已连接：${agents.join('、')}`
      : '未连接来自工具'
  }

  function update(state: AppStateSnapshot): void {
    currentSettings = state.settings
    currentPets = state.pets
    currentAgents = state.agents
    libraryRoot.textContent = `宠物库路径：${state.libraryRoot || '未找到'}`
    statusLine.textContent = state.agents.length > 0
      ? `已连接：${state.agents.join('、')}`
      : '未连接来自工具'
    renderPetList()
    renderAgents()
    renderSettings()
  }

  function setError(message: string | null): void {
    errorLine.textContent = message ?? ''
    errorLine.hidden = message === null || message === ''
  }

  const app: SettingsApp = {
    root,
    update,
    setAgents,
    setPets,
    setSettings,
    setError,
  }
  return app
}

export function createSettingsApp(root: HTMLElement, client: UiClient): SettingsApp {
  return mountSettingsApp(root, client)
}
