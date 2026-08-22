import './style.css'
import { detectWindowKind } from './window-kind'

const kind = detectWindowKind(window.location.search)
const label = document.querySelector<HTMLParagraphElement>('#window-label')

if (label) {
  label.textContent = kind === 'settings'
    ? 'Settings window'
    : 'Pet window'
}

document.title = kind === 'settings' ? 'Pet Settings' : 'Desktop Pet'
