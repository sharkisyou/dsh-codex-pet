import { Config } from '@remotion/cli/config'

// 视频编码：WebM (VP9) 体积小、适合预览；要 mp4 用 --codec=h264
Config.setVideoImageFormat('jpeg')
Config.setCodec('h264')
Config.setOverwriteOutput(true)
