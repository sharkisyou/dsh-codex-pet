import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

export const SceneTitle: React.FC<{
  zh: string
  en: string
  accent?: string
  delay?: number
}> = ({ zh, en, accent = '#5eb1ff', delay = 0 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const appear = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, mass: 0.8 },
  })
  const opacity = interpolate(frame - delay, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(frame - delay, [0, 14], [26, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        opacity,
        transform: `translateY(${y * (1 - appear)}px) scale(${0.96 + 0.04 * appear})`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <div style={{ width: 52, height: 3, borderRadius: 2, background: accent }} />
        <div
          style={{
            fontSize: 58,
            fontWeight: 700,
            color: '#f4f7ff',
            letterSpacing: 2,
          }}
        >
          {zh}
        </div>
        <div style={{ width: 52, height: 3, borderRadius: 2, background: accent }} />
      </div>
      <div
        style={{
          fontSize: 24,
          color: '#8ea0c8',
          letterSpacing: 4,
          textTransform: 'uppercase',
        }}
      >
        {en}
      </div>
    </div>
  )
}
