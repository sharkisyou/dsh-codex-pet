import React from 'react'
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { PetSprite } from '../PetSprite'

export const EndScene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const appear = spring({ frame, fps, config: { damping: 13, mass: 0.8 } })
  const float = Math.sin((frame / fps) * Math.PI * 2 * 0.5) * 8

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 26,
        transform: `scale(${1 + (1 - appear) * 0.06})`,
      }}
    >
      <div style={{ transform: `translateY(${float}px)` }}>
        <PetSprite state="waving" scale={2.2} />
      </div>
      <div style={{ fontSize: 72, fontWeight: 800, color: '#f4f7ff', letterSpacing: 2 }}>
        dsh-pet-plugin
      </div>
      <div style={{ fontSize: 26, color: '#8ea0c8', letterSpacing: 4 }}>
        开源 · Open Source · GitHub
      </div>
    </AbsoluteFill>
  )
}
