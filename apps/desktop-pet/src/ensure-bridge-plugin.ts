/**
 * 确保 DSH 桥接插件已安装到目标 profile。
 *
 * 背景：桌宠要显示 DSH 会话活动，需要 `@yshark/dsh-codex-pet` 桥接插件装在
 * DSH profile 里。手动安装（`dsh plugin --profile <name> add <pkg>`）是额外
 * 步骤；本模块让 pet server 启动时自动检测并安装，降低使用复杂度。
 *
 * 设计：
 * - 默认 profile `web`、插件 `@yshark/dsh-codex-pet`，可用环境变量覆盖。
 * - 幂等：已注册则跳过（用 `dsh plugin list` 判断）。
 * - 非阻塞：安装失败只告警，不影响 pet server 启动。
 * - 优雅：无 `dsh` 命令或非 DSH 环境时直接跳过。
 */

import { execFile } from 'node:child_process'

export interface EnsureBridgePluginOptions {
  /** 目标 DSH profile 名。默认 web，可用 DSH_PET_PROFILE 覆盖。 */
  profile?: string
  /** 桥接插件包名。默认 @yshark/dsh-codex-pet，可用 DSH_PET_PLUGIN 覆盖。 */
  plugin?: string
  /** 是否允许自动安装。默认开启，可用 DSH_PET_AUTO_INSTALL=0 关闭。 */
  enabled?: boolean
  /** dsh 可执行文件路径。默认 'dsh'（走 PATH）。 */
  dshBin?: string
  /** 检测已安装的回调（测试注入）。 */
  isInstalled?: (profile: string, plugin: string) => Promise<boolean>
  /** 执行安装的回调（测试注入）。 */
  install?: (profile: string, plugin: string) => Promise<void>
}

export const DEFAULT_PROFILE = 'web'
export const DEFAULT_PLUGIN = '@yshark/dsh-codex-pet'

/** 运行 dsh CLI 并返回 stdout（去尾空白）。 */
function runDsh(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 120_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || '').trim() || error.message))
        return
      }
      resolve((stdout || '').trim())
    })
  })
}

/** 检查 profile 的 dependencies 是否已含该插件（dsh plugin list 输出含包名）。 */
export async function detectInstalled(bin: string, profile: string, plugin: string): Promise<boolean> {
  const out = await runDsh(bin, ['plugin', '--profile', profile, 'list'])
  const name = plugin.split('/').pop() ?? plugin
  return out.split('\n').some((line) => line.includes(plugin) || line.includes(`@${name}`))
}

/** 安装插件到 profile。 */
export async function installPlugin(bin: string, profile: string, plugin: string): Promise<void> {
  await runDsh(bin, ['plugin', '--profile', profile, 'add', plugin])
}

function log(...args: unknown[]): void {
  console.log('[desktop-pet]', ...args)
}

/**
 * 确保桥接插件已安装。返回 true 表示已就绪（已装或本次装上），false 表示
 * 跳过（禁用/非 DSH 环境/失败）。不抛错。
 */
export async function ensureBridgePlugin(options: EnsureBridgePluginOptions = {}): Promise<boolean> {
  const profile = options.profile ?? process.env.DSH_PET_PROFILE ?? DEFAULT_PROFILE
  const plugin = options.plugin ?? process.env.DSH_PET_PLUGIN ?? DEFAULT_PLUGIN
  const enabled = options.enabled ?? String(process.env.DSH_PET_AUTO_INSTALL ?? '1') !== '0'
  const bin = options.dshBin ?? 'dsh'
  const isInstalled = options.isInstalled ?? (() => detectInstalled(bin, profile, plugin))
  const install = options.install ?? (() => installPlugin(bin, profile, plugin))

  if (!enabled) {
    log('跳过桥接插件自动安装（DSH_PET_AUTO_INSTALL=0）')
    return false
  }

  try {
    const already = await isInstalled(profile, plugin)
    if (already) {
      log(`桥接插件 ${plugin} 已安装（profile ${profile}）`)
      return true
    }
  } catch (error) {
    log('检测桥接插件状态失败（可能无 dsh 命令），跳过自动安装：',
      error instanceof Error ? error.message : String(error))
    return false
  }

  log(`检测到桥接插件未安装，正在安装到 profile ${profile}...`)
  try {
    await install(profile, plugin)
    log(`桥接插件 ${plugin} 安装完成`)
    return true
  } catch (error) {
    log('桥接插件安装失败（不影响桌宠服务）：',
      error instanceof Error ? error.message : String(error))
    return false
  }
}
