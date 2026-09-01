import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import spritesheet from '../assets/dimo.png'

// 与 apps/desktop-pet 的标准 Codex atlas 一致：8 列 × 9 行，单元格 192×208
export const ROW_NAMES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
] as const

export const ROW_FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const
export const DEFAULT_FRAME_MS = 140
export const CELL_W = 192
export const CELL_H = 208
export const COLS = 8
export const ROWS = 9

export const PetSprite: React.FC<{
  state?: string
  scale?: number
  style?: React.CSSProperties
  pixelated?: boolean
}> = ({ state = 'idle', scale = 2, style, pixelated = true }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rowIndex = Math.max(0, ROW_NAMES.indexOf(state as (typeof ROW_NAMES)[number]))
  const frameCount = ROW_FRAME_COUNTS[rowIndex] ?? 8
  const elapsedMs = (frame / fps) * 1000
  const idx = Math.floor(elapsedMs / DEFAULT_FRAME_MS) % frameCount

  const w = CELL_W * scale
  const h = CELL_H * scale

  return (
    <div
      style={{
        width: w,
        height: h,
        backgroundImage: `url(${spritesheet})`,
        backgroundSize: `${CELL_W * COLS * scale}px ${CELL_H * ROWS * scale}px`,
        backgroundPosition: `-${idx * CELL_W * scale}px -${rowIndex * CELL_H * scale}px`,
        imageRendering: pixelated ? 'pixelated' : 'auto',
        filter: 'drop-shadow(0 14px 28px rgba(0,0,0,0.5))',
        ...style,
      }}
    />
  )
}
