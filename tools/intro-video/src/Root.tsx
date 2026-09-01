import React from 'react'
import { Composition } from 'remotion'
import { IntroVideo } from './IntroVideo'

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="IntroVideo"
      component={IntroVideo}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  )
}
