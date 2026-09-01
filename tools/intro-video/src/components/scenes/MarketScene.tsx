import React from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { SceneTitle } from '../SceneTitle'
import thumbBatmeme from '../../assets/thumbs/batmeme.png'
import thumbDimo from '../../assets/thumbs/dimo-4.png'
import thumbLulu from '../../assets/thumbs/lulu-capybara-2.png'
import thumbHerta from '../../assets/thumbs/the-herta.png'
import thumbRx78 from '../../assets/thumbs/rx-78-2-gundam.png'
import thumbShana from '../../assets/thumbs/shana-pet.png'
import thumbVivian from '../../assets/thumbs/vivian.png'
import thumbChibi from '../../assets/thumbs/chibi-gundam.png'
import thumbXiaoRemu from '../../assets/thumbs/xiao-remu.png'
import thumbKoko from '../../assets/thumbs/koko-2.png'

const PETS = [
  { src: thumbDimo, name: 'Dimo', slug: 'dimo' },
  { src: thumbBatmeme, name: 'Batmeme', slug: 'batmeme' },
  { src: thumbLulu, name: 'Lulu', slug: 'lulu-capybara' },
  { src: thumbHerta, name: 'The Herta', slug: 'the-herta' },
  { src: thumbRx78, name: 'RX-78-2', slug: 'rx-78-2-gundam' },
  { src: thumbShana, name: 'Shana', slug: 'shana-pet' },
  { src: thumbVivian, name: 'Vivian', slug: 'vivian' },
  { src: thumbChibi, name: 'Chibi Gundam', slug: 'chibi-gundam' },
  { src: thumbXiaoRemu, name: 'Xiao Remu', slug: 'xiao-remu' },
  { src: thumbKoko, name: 'Koko', slug: 'koko-2' },
] as const

const THUMB_W = 128
const THUMB_H = 139

export const MarketScene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // 安装演示时间点（场景内帧）
  const installClicked = 70
  const installing = frame >= installClicked && frame < installClicked + 20
  const installed = frame >= installClicked + 20

  const statIn = spring({ frame: frame - 24, fps, config: { damping: 13, mass: 0.9 } })

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 66,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <SceneTitle zh="在线宠物市场" en="Pet Market" delay={6} />
      </div>

      {/* 左侧：宠物网格 */}
      <div
        style={{
          position: 'absolute',
          left: 130,
          top: 210,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 18,
          width: 1080,
        }}
      >
        {PETS.map((p, i) => {
          const delay = 8 + i * 4
          const appear = spring({ frame: frame - delay, fps, config: { damping: 14 } })
          const isDimo = p.slug === 'dimo'
          return (
            <div
              key={p.slug}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: '18px 12px 16px',
                borderRadius: 18,
                background: 'rgba(13,19,44,0.85)',
                border: '1px solid rgba(255,255,255,0.09)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
                opacity: appear,
                transform: `translateY(${(1 - appear) * 30}px) scale(${0.9 + 0.1 * appear})`,
              }}
            >
              <div style={{ width: THUMB_W, height: THUMB_H, overflow: 'hidden', borderRadius: 12 }}>
                <img
                  src={p.src}
                  width={THUMB_W}
                  height={THUMB_H}
                  style={{ display: 'block', imageRendering: 'pixelated' }}
                />
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#c8d4f2' }}>{p.name}</div>

              {isDimo && (
                <div
                  style={{
                    position: 'relative',
                    width: 130,
                    height: 40,
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  {!installed && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 999,
                        background: installing
                          ? 'linear-gradient(90deg, #3d6fd1, #5eb1ff)'
                          : '#5eb1ff',
                        color: '#fff',
                        fontSize: 18,
                        fontWeight: 700,
                        opacity: interpolate(frame, [installClicked - 14, installClicked - 4], [0, 1], {
                          extrapolateLeft: 'clamp',
                          extrapolateRight: 'clamp',
                        }),
                      }}
                    >
                      {installing ? '安装中…' : '安装 Install'}
                    </div>
                  )}
                  {installed && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 999,
                        background: 'rgba(110,231,160,0.16)',
                        border: '1px solid #6ee7a0',
                        color: '#6ee7a0',
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      ✓ 已安装 Installed
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 右侧：数据面板 */}
      <div
        style={{
          position: 'absolute',
          right: 130,
          top: 210,
          width: 460,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div
          style={{
            borderRadius: 22,
            padding: '34px 36px',
            background: 'linear-gradient(160deg, rgba(94,177,255,0.16), rgba(13,19,44,0.85))',
            border: '1px solid rgba(94,177,255,0.35)',
            opacity: statIn,
            transform: `translateY(${(1 - statIn) * 30}px)`,
          }}
        >
          <div style={{ fontSize: 74, fontWeight: 800, color: '#5eb1ff', lineHeight: 1 }}>
            4600+
          </div>
          <div style={{ fontSize: 26, color: '#c8d4f2', marginTop: 8 }}>
            宠物在线，一键安装
          </div>
          <div style={{ fontSize: 18, color: '#8ea0c8', marginTop: 4 }}>
            pets online · one-click install
          </div>
        </div>

        <div
          style={{
            borderRadius: 22,
            padding: '26px 34px',
            background: 'rgba(13,19,44,0.85)',
            border: '1px solid rgba(255,255,255,0.09)',
            opacity: interpolate(frame, [30, 44], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translateY(${interpolate(frame, [30, 44], [24, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}px)`,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f4f7ff' }}>浏览 · 筛选 · 安装</div>
          <div style={{ fontSize: 18, color: '#8ea0c8', marginTop: 6 }}>
            类型筛选、搜索、详情预览，全部开箱即用
          </div>
          <div style={{ fontSize: 16, color: '#5b6a94', marginTop: 4 }}>
            Browse · filter · detail preview · ready to use
          </div>
        </div>

        <div
          style={{
            borderRadius: 22,
            padding: '26px 34px',
            background: 'rgba(13,19,44,0.85)',
            border: '1px solid rgba(255,255,255,0.09)',
            opacity: interpolate(frame, [44, 58], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translateY(${interpolate(frame, [44, 58], [24, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}px)`,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f4f7ff' }}>与 Codex 宠物库兼容</div>
          <div style={{ fontSize: 18, color: '#8ea0c8', marginTop: 6 }}>
            直接读取 ~/.codex/pets，零迁移
          </div>
          <div style={{ fontSize: 16, color: '#5b6a94', marginTop: 4 }}>
            Codex pet library compatible · zero migration
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
