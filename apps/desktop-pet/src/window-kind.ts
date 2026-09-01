export type WindowKind = 'pet' | 'settings' | 'tray'

export function detectWindowKind(search: string): WindowKind {
  if (/(?:^|[?&])window=settings(?:&|$)/.test(search)) return 'settings'
  if (/(?:^|[?&])window=tray(?:&|$)/.test(search)) return 'tray'
  return 'pet'
}
