import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { Background } from './components/Background'
import { Scene } from './components/Scene'
import { TitleScene } from './components/scenes/TitleScene'
import { StateScene } from './components/scenes/StateScene'
import { MultiSessionScene } from './components/scenes/MultiSessionScene'
import { MarketScene } from './components/scenes/MarketScene'
import { EndScene } from './components/scenes/EndScene'

// 30s @ 30fps = 900 帧；每个场景独立时长窗口，避免叠压
const SCENES = [
  { from: 0, duration: 180, Comp: TitleScene }, // 0–6s
  { from: 180, duration: 270, Comp: StateScene }, // 6–15s
  { from: 450, duration: 210, Comp: MultiSessionScene }, // 15–22s
  { from: 660, duration: 180, Comp: MarketScene }, // 22–28s
  { from: 840, duration: 60, Comp: EndScene }, // 28–30s
] as const

export const IntroVideo: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        fontFamily:
          "'Noto Sans CJK SC', 'Noto Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      }}
    >
      <Background />
      {SCENES.map(({ from, duration, Comp }) => (
        <Sequence key={from} from={from} durationInFrames={duration} name={`${from}`}>
          <Scene duration={duration}>
            <Comp />
          </Scene>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
