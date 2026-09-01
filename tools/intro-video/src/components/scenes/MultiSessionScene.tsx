import React from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { SceneTitle } from '../SceneTitle'
import { PetSprite } from '../PetSprite'

// 优先级在三个会话间循环，每个 2s（60 帧）
const PRIORITY_DURATION = 60

const SESSIONS = [
  {
    name: '设计宠物市场 UI',
    en: 'Designing pet market UI',
    status: '运行中',
    statusEn: 'Running',
    anim: 'running',
    color: '#5eb1ff',
  },
  {
    name: '修复渲染闪烁',
    en: 'Fixing render flicker',
    status: '需要输入',
    statusEn: 'Waiting for input',
    anim: 'waiting',
    color: '#ffd166',
  },
  {
    name: '编写宠物包文档',
    en: 'Writing pet package docs',
    status: '就绪',
    statusEn: 'Ready',
    anim: 'review',
    color: '#6ee7a0',
  },
] as const

export const MultiSessionScene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const active = Math.floor(frame / PRIORITY_DURATION) % SESSIONS.length
  const session = SESSIONS[active]

  const trayIn = spring({ frame: frame - 8, fps, config: { damping: 13, mass: 0.8 } })
  const float = Math.sin((frame / fps) * Math.PI * 2 * 0.4) * 10

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 56,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <SceneTitle zh="多会话同时跟踪" en="Tracks multiple sessions at once" delay={6} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 190,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* 活动托盘 */}
        <div
          style={{
            width: 860,
            borderRadius: 24,
            background: 'rgba(13,19,44,0.88)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            padding: '22px 28px',
            transform: `translateY(${(1 - trayIn) * 40}px) scale(${0.96 + 0.04 * trayIn})`,
            opacity: trayIn,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: '#9fb0d8' }}>活动会话 · Active Sessions</span>
            <span style={{ fontSize: 18, color: '#5b6a94' }}>点击即可切换 · Click to switch</span>
          </div>

          {SESSIONS.map((s, i) => {
            const isActive = i === active
            return (
              <div
                key={s.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  padding: '14px 20px',
                  borderRadius: 14,
                  marginBottom: 10,
                  background: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isActive ? s.color : 'transparent'}`,
                  transform: `translateX(${isActive ? 8 : 0}px)`,
                }}
              >
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 999,
                    background: s.color,
                    boxShadow: isActive ? `0 0 14px ${s.color}` : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 26, color: isActive ? '#f4f7ff' : '#9fb0d8', fontWeight: 600, flex: 1 }}>
                  {s.name}
                </span>
                <span style={{ fontSize: 19, color: '#5b6a94' }}>{s.en}</span>
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: isActive ? s.color : '#5b6a94',
                    minWidth: 100,
                    textAlign: 'right',
                  }}
                >
                  {s.status} · {s.statusEn}
                </span>
              </div>
            )
          })}
        </div>

        {/* 宠物跟随最高优先级会话 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: 18,
          }}
        >
          <div style={{ transform: `translateY(${float}px)` }}>
            <PetSprite state={session.anim} scale={1.6} />
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 20,
              color: '#8ea0c8',
              letterSpacing: 1,
            }}
          >
            同一时刻只展示优先级最高的会话 · Shows only the highest-priority session
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
