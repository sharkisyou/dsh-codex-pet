export type WindowKind = 'pet' | 'settings'

export function detectWindowKind(search: string): WindowKind {
  return /(?:^|[?&])window=settings(?:&|$)/.test(search) ? 'settings' : 'pet'
}
