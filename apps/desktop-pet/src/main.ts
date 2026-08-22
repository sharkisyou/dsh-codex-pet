import './style.css'
import { detectWindowKind } from './window-kind'
import { createPetRenderer } from './renderer'

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
      <div class="pet-stage">
        <canvas id="pet-canvas" width="240" height="240"></canvas>
        <p id="pet-status" class="pet-status">空闲</p>
      </div>
    `
    const canvas = document.querySelector<HTMLCanvasElement>('#pet-canvas')
    const status = document.querySelector<HTMLParagraphElement>('#pet-status')
    if (canvas) {
      const renderer = createPetRenderer(canvas, { frameRate: 80 })
      renderer.setState('idle')
      renderer.setBubble('idle')
      renderer.start()
      if (status) {
        status.textContent = '桌宠已就绪（等待桥接连接）'
      }
    }
  }
}
