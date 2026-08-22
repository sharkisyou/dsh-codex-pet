/**
 * Animation frame selection: given an animation definition and elapsed time,
 * return the current frame and whether the animation has finished.
 */

export const FALLBACK_FRAME_MS = 140

export interface AnimationDefinition {
  frameCount: number
  timingMs?: readonly number[]
  playback?: 'once' | 'loop'
  loop?: boolean
}

export interface FrameResult {
  frame: number
  finished: boolean
}

export function totalDuration(timing: readonly number[] | undefined, count: number): number {
  let total = 0
  for (let i = 0; i < count; i++) {
    total += timing?.[i] !== undefined ? timing[i] : FALLBACK_FRAME_MS
  }
  return total
}

export function frameIndex(anim: AnimationDefinition, elapsedMs: number): FrameResult {
  const count = anim.frameCount
  if (count <= 1) return { frame: 0, finished: false }
  const timing = anim.timingMs ?? []
  const total = totalDuration(timing, count)
  const t = elapsedMs < 0 ? 0 : elapsedMs
  const once = anim.playback === 'once' || anim.loop === false
  if (once && t >= total) {
    return { frame: count - 1, finished: true }
  }
  const pos = t % total
  let acc = 0
  for (let i = 0; i < count; i++) {
    acc += timing[i] !== undefined ? timing[i] : FALLBACK_FRAME_MS
    if (pos < acc) return { frame: i, finished: false }
  }
  return { frame: count - 1, finished: false }
}

export function cycleNext(current: string | null | undefined, list: readonly string[] | null | undefined): string | null {
  if (!Array.isArray(list) || list.length === 0) return null
  const index = list.indexOf(current as string)
  if (index < 0) return list[0]
  return list[(index + 1) % list.length]
}
