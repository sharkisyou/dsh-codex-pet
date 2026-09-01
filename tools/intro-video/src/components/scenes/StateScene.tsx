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

// 每个状态展示 1.8s（54 帧）
const STATE_DURATION = 54

const STATES = [
  {
    anim: 'idle',
    zh: '空闲',
    en: 'Idle',
    bubble: '空闲',
    desc: '随时待命，准备出发',
    descEn: 'Ready when you are',
    color: '#8ea0c8',
  },
  {
    anim: 'waiting',
    zh: '思考',
    en: 'Thinking',
    bubble: '思考中',
    desc: '正在推理你的请求',
    descEn: 'Reasoning through your request',
    color: '#5eb1ff',
  },
  {
    anim: 'running',
    zh: '工作',
    en: 'Working',
    bubble: '执行工具',
    desc: '正在执行工具',
    descEn: 'Running tools for you',
    color: '#6ee7a0',
  },
  {
    anim: 'failed',
    zh: '失败',
    en: 'Failed',
    bubble: '失败',
    desc: '出错时会第一时间告诉你',
    descEn: 'Alerts you the moment things fail',
    color: '#ff7b7b',
  },
  {
    anim: 'review',
    zh: '就绪',
    en: 'Ready',
    bubble: '就绪',
    desc: '工作完成，等你查看',
    descEn: 'Done — ready for your review',
    color: '#ffd166',
  },
] as const

export const StateScene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const active = Math.floor(frame / STATE_DURATION) % STATES.length
  const state = STATES[active]

  const inStateFrame = frame % STATE_DURATION
  const statePop = spring({
    frame: inStateFrame,
    fps,
    config: { damping: 12, mass: 0.7 },
  })

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 84, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <SceneTitle zh="它懂你的工作状态" en="It knows how you work" delay={6} />
      </div>

      {/* 左侧：宠物 + 气泡 */}
      <div
        style={{
          position: 'absolute',
          left: 220,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}
      >
        <div
          style={{
            padding: '14px 30px',
            borderRadius: 999,
            background: 'rgba(244,247,255,0.95)',
            color: '#0f1630',
            fontSize: 34,
            fontWeight: 700,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            opacity: interpolate(inStateFrame, [0, 8], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translateY(${(1 - statePop) * 18}px)`,
          }}
        >
          {state.bubble}
        </div>
        <div style={{ transform: `scale(${0.92 + 0.08 * statePop})` }}>
          <PetSprite state={state.anim} scale={2.6} />
        </div>
      </div>

      {/* 右侧：状态列表 */}
      <div
        style={{
          position: 'absolute',
          right: 200,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 22,
          width: 620,
        }}
      >
        {STATES.map((s, i) => {
          const isActive = i === active
          const opacity = interpolate(frame, [i * STATE_DURATION + 30, i * STATE_DURATION + 40], [1, 0.42], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          return (
            <div
              key={s.anim}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                padding: '20px 26px',
                borderRadius: 18,
                background: isActive ? 'rgba(244,247,255,0.10)' : 'rgba(244,247,255,0.04)',
                border: `1px solid ${isActive ? s.color : 'rgba(255,255,255,0.08)'}`,
                boxShadow: isActive ? `0 0 40px ${s.color}33` : 'none',
                transform: `translateX(${(1 - statePop) * (isActive ? 14 : 0)}px)`,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: s.color,
                  boxShadow: isActive ? `0 0 16px ${s.color}` : 'none',
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 170 }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: isActive ? '#f4f7ff' : '#c8d4f2' }}>
                  {s.zh}
                </span>
                <span style={{ fontSize: 20, color: '#8ea0c8', marginLeft: 14 }}>{s.en}</span>
              </div>
              <div
                style={{
                  fontSize: 22,
                  color: isActive ? '#9fb0d8' : 'transparent',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                {s.desc} · {s.descEn}
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
