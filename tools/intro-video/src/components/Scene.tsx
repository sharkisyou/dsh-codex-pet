import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'

/**
 * 场景容器：只在其 Sequence 时长内可见，开头淡入、结尾淡出。
 * 防止不同场景互相叠压。
 */
export const Scene: React.FC<{
  duration: number
  children: React.ReactNode
}> = ({ duration, children }) => {
  const frame = useCurrentFrame()
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const fadeOut = interpolate(frame, [duration - 14, duration - 2], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const opacity = Math.min(fadeIn, fadeOut)
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}
