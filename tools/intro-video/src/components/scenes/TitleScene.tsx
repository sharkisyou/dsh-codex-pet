import React from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { PetSprite } from '../PetSprite'

export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const fadeIn = spring({
    frame,
    fps,
    config: { damping: 16, mass: 0.9 },
  })
  const textOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const textY = interpolate(frame, [0, 16], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const petY = interpolate(frame, [0, 18], [80, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const petScale = interpolate(frame, [0, 18], [0.8, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // 宠物上下浮动
  const float = Math.sin((frame / fps) * Math.PI * 2 * 0.4) * 14

  const chipOpacity = interpolate(frame, [18, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill>
      {/* 左侧文案 */}
      <div
        style={{
          position: 'absolute',
          left: 190,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: 880,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            alignSelf: 'flex-start',
            padding: '10px 20px',
            borderRadius: 999,
            background: 'rgba(94,177,255,0.14)',
            border: '1px solid rgba(94,177,255,0.4)',
            color: '#9cc6ff',
            fontSize: 22,
            letterSpacing: 1,
            opacity: chipOpacity,
            marginBottom: 34,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 999, background: '#5eb1ff' }} />
          DeepSeek Harness · 桥接插件 / Bridge Plugin
        </div>

        <div
          style={{
            opacity: textOpacity,
            transform: `translateY(${textY}px)`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: 168,
              fontWeight: 800,
              color: '#f4f7ff',
              letterSpacing: 8,
              lineHeight: 1.05,
            }}
          >
            桌宠
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 600,
              color: '#8ea0c8',
              letterSpacing: 14,
              marginTop: 6,
              textTransform: 'uppercase',
            }}
          >
            Desktop&nbsp;Pet
          </div>
          <div
            style={{
              width: 120,
              height: 4,
              borderRadius: 2,
              background: 'linear-gradient(90deg, #5eb1ff, #ffd166)',
              marginTop: 30,
            }}
          />
          <div
            style={{
              fontSize: 30,
              color: '#c8d4f2',
              marginTop: 26,
              lineHeight: 1.6,
            }}
          >
            你的 AI 伙伴，常驻桌面
            <br />
            <span style={{ fontSize: 22, color: '#8ea0c8' }}>
              Your AI companion, always by your side
            </span>
          </div>
        </div>
      </div>

      {/* 右侧宠物 */}
      <div
        style={{
          position: 'absolute',
          right: 210,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: petScale,
          transform: `translateY(${petY + float}px) scale(${petScale})`,
        }}
      >
        <PetSprite state="idle" scale={3} />
      </div>
    </AbsoluteFill>
  )
}
