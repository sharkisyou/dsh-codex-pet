import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureBridgePlugin, DEFAULT_PLUGIN, DEFAULT_PROFILE } from '../src/ensure-bridge-plugin'

test('常量默认值合理', () => {
  assert.equal(DEFAULT_PROFILE, 'web')
  assert.equal(DEFAULT_PLUGIN, '@yshark/dsh-codex-pet')
})

test('已安装时跳过安装（幂等）', async () => {
  let installCalled = 0
  const ok = await ensureBridgePlugin({
    enabled: true,
    profile: 'web',
    plugin: '@yshark/dsh-codex-pet',
    isInstalled: async () => true,
    install: async () => { installCalled += 1 },
  })
  assert.equal(ok, true)
  assert.equal(installCalled, 0, '已安装不应再安装')
})

test('未安装时自动安装', async () => {
  const installed: string[] = []
  const ok = await ensureBridgePlugin({
    enabled: true,
    profile: 'web',
    plugin: '@yshark/dsh-codex-pet',
    isInstalled: async () => false,
    install: async (profile, plugin) => { installed.push(`${profile}:${plugin}`) },
  })
  assert.equal(ok, true)
  assert.deepEqual(installed, ['web:@yshark/dsh-codex-pet'])
})

test('检测失败（无 dsh 命令）时跳过，不抛错', async () => {
  const ok = await ensureBridgePlugin({
    enabled: true,
    isInstalled: async () => { throw new Error('dsh: command not found') },
    install: async () => { throw new Error('should not be called') },
  })
  assert.equal(ok, false)
})

test('安装失败不抛错、返回 false', async () => {
  const ok = await ensureBridgePlugin({
    enabled: true,
    isInstalled: async () => false,
    install: async () => { throw new Error('pnpm add failed') },
  })
  assert.equal(ok, false)
})

test('disabled 时跳过', async () => {
  let isInstalledCalled = 0
  const ok = await ensureBridgePlugin({
    enabled: false,
    isInstalled: async () => { isInstalledCalled += 1; return true },
    install: async () => {},
  })
  assert.equal(ok, false)
  assert.equal(isInstalledCalled, 0, 'disabled 时不应检测')
})
