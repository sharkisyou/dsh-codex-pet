import React from 'react'
import { AbsoluteFill } from 'remotion'

export const Background: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(1400px 900px at 75% 12%, #23315f 0%, #121a38 48%, #070b18 100%)',
      }}
    >
      {/* 细网格 */}
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(120,150,220,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,220,0.07) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* 氛围光斑 */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(700px 520px at 18% 82%, rgba(94,177,255,0.12) 0%, transparent 70%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(520px 420px at 88% 18%, rgba(255,209,102,0.07) 0%, transparent 70%)',
        }}
      />
    </AbsoluteFill>
  )
}
