/**
 * Pet package parsing/normalization.
 *
 * Pure logic, no side effects. Compatible with Codex pet packages v1/v2 and
 * the community `animations` / `interactions.click` extensions.
 */

export const ROW_NAMES = [
  'idle', 'running-right', 'running-left', 'waving', 'jumping',
  'failed', 'waiting', 'running', 'review',
] as const

export const ROW_FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const

export const DEFAULT_FRAME_MS = 140

export const IMAGE_EXTS = ['.png', '.webp'] as const

export interface PetAnimationState {
  row: number
  frameCount: number
  timingMs: number[]
  playback: 'once' | 'loop'
  loop: boolean
}

export interface ParsedPet {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  kind: string | null
  spriteVersionNumber: number
  states: Record<string, PetAnimationState>
  clickAnimations: string[]
}

export type ParsePetJsonResult =
  | { ok: true; pet: ParsedPet }
  | { ok: false; errors: string[] }

export interface AssessPackageResult {
  valid: boolean
  reason: string | null
}

export function stripBom(text: string): string {
  if (typeof text === 'string' && text.charCodeAt(0) === 0xfeff) return text.slice(1)
  return text
}

function resolveRow(sourceRow: unknown, atlasRows: number): number {
  if (typeof sourceRow === 'number' && Number.isInteger(sourceRow) &&
      sourceRow >= 0 && sourceRow < atlasRows) {
    return sourceRow
  }
  if (typeof sourceRow === 'string') {
    const index = ROW_NAMES.indexOf(sourceRow as (typeof ROW_NAMES)[number])
    if (index >= 0) return index
  }
  return -1
}

function clampFrameCount(value: unknown, official: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return official
  return Math.min(Math.max(value, 1), official)
}

function buildTiming(timingMs: unknown, frameCount: number): number[] {
  const out = new Array<number>(frameCount).fill(DEFAULT_FRAME_MS)
  if (Array.isArray(timingMs)) {
    for (let i = 0; i < frameCount && i < timingMs.length; i++) {
      const value = timingMs[i]
      if (typeof value === 'number' && value > 0) out[i] = value
    }
  }
  return out
}

export function parsePetJson(text: string, atlasRows: number): ParsePetJsonResult {
  let json: unknown
  try {
    json = JSON.parse(stripBom(text))
  } catch {
    return { ok: false, errors: ['pet.json 不是合法 JSON'] }
  }
  if (json === null || typeof json !== 'object') {
    return { ok: false, errors: ['pet.json 顶层必须是对象'] }
  }

  const record = json as Record<string, unknown>
  const errors: string[] = []
  for (const key of ['id', 'displayName', 'description', 'spritesheetPath'] as const) {
    if (typeof record[key] !== 'string' || record[key] === '') {
      errors.push(`缺少字段 ${key}`)
    }
  }

  const version = record.spriteVersionNumber === undefined ? 1 : record.spriteVersionNumber
  if (version !== 1 && version !== 2) {
    errors.push('spriteVersionNumber 必须是 1 或 2')
  }
  if (errors.length > 0) return { ok: false, errors }

  const states: Record<string, PetAnimationState> = {}
  for (let row = 0; row < atlasRows; row++) {
    const name = ROW_NAMES[row] !== undefined ? ROW_NAMES[row] : `row-${row}`
    const frameCount = ROW_FRAME_COUNTS[row] !== undefined ? ROW_FRAME_COUNTS[row] : 8
    const playback = name === 'waving' || name === 'jumping' ? 'once' : 'loop'
    states[name] = {
      row,
      frameCount,
      timingMs: new Array<number>(frameCount).fill(DEFAULT_FRAME_MS),
      playback,
      loop: playback === 'loop',
    }
  }

  // Community extension: animations metadata overrides standard rows.
  const animations = record.animations
  if (animations !== null && typeof animations === 'object' && !Array.isArray(animations)) {
    for (const [animName, meta] of Object.entries(animations as Record<string, unknown>)) {
      if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) continue
      const anim = meta as Record<string, unknown>
      const row = resolveRow(anim.sourceRow, atlasRows)
      if (row === -1) continue
      const baseCount = ROW_FRAME_COUNTS[row] !== undefined ? ROW_FRAME_COUNTS[row] : 8
      const frameCount = clampFrameCount(anim.frameCount, baseCount)
      const timingMs = buildTiming(anim.timingMs, frameCount)
      const playback = anim.playback === 'once' ? 'once' : 'loop'
      states[animName] = {
        row,
        frameCount,
        timingMs,
        playback,
        loop: anim.loop === false ? false : playback === 'loop',
      }
    }
  }

  let clickAnimations: string[] = []
  const interactions = record.interactions
  if (interactions !== null && typeof interactions === 'object' && !Array.isArray(interactions)) {
    const click = (interactions as Record<string, unknown>).click
    if (click !== null && typeof click === 'object' && !Array.isArray(click)) {
      const clickAnim = (click as Record<string, unknown>).animations
      if (Array.isArray(clickAnim)) {
        clickAnimations = clickAnim.filter(
          (name): name is string => typeof name === 'string' && states[name] !== undefined,
        )
      }
    }
  }

  return {
    ok: true,
    pet: {
      id: record.id as string,
      displayName: record.displayName as string,
      description: record.description as string,
      spritesheetPath: record.spritesheetPath as string,
      kind: typeof record.kind === 'string' ? record.kind : null,
      spriteVersionNumber: version as number,
      states,
      clickAnimations,
    },
  }
}

export function assessPackageDir(fileNames: readonly string[]): AssessPackageResult {
  if (!fileNames.includes('pet.json')) {
    return { valid: false, reason: '缺少 pet.json' }
  }
  const hasImage = fileNames.some((name) =>
    IMAGE_EXTS.some((ext) => name.toLowerCase().endsWith(ext)))
  if (!hasImage) {
    return { valid: false, reason: '缺少图集文件（png/webp）' }
  }
  return { valid: true, reason: null }
}
