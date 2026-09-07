/**
 * Standalone entry point for the desktop pet WebSocket server.
 *
 * This is useful during development and for tests that want a real Node
 * process accepting bridge connections. The Tauri shell can also spawn this
 * as a sidecar; the server module itself is kept dependency-injectable so the
 * same logic can be exercised without opening a socket.
 */

import { createPetServer } from './server.js'
import { createPetLibrary } from './pet-library.js'
import { createSettingsStore, resolveAppDataDir } from './settings-store.js'
import { createAppController } from './controller.js'
import { createUiGateway, UI_PROTOCOL_PATH } from './ui-gateway.js'
import { createMarket } from './market.js'
import { ensureBridgePlugin } from './ensure-bridge-plugin.js'
import { createFileLog, resolveServerLogFile, teeConsole } from './file-log.js'
import { join } from 'node:path'

// 日志落盘：console 输出 tee 到 ~/.dsh/logs/pet-server.log（PET_SERVER_LOG 可指定路径/关闭），
// 不再依赖启动方式是否重定向 stdout；与桥接插件的 pet-bridge.log 同目录，便于对照排障。
const serverFileLog = createFileLog(resolveServerLogFile())
if (serverFileLog) {
  teeConsole(serverFileLog)
  console.log(`[desktop-pet] file log: ${serverFileLog.path}`)
}

const library = createPetLibrary()
const store = createSettingsStore()
// MARKET_CACHE_TTL_HOURS 可覆盖 manifest 缓存时长（单位：小时），默认 48 小时。
const marketTtlHours = Number(process.env.MARKET_CACHE_TTL_HOURS)
const market = createMarket({
  cacheTtlMs: Number.isFinite(marketTtlHours) && marketTtlHours > 0
    ? Math.round(marketTtlHours * 60 * 60 * 1000)
    : undefined,
  // manifest 落盘：重启不依赖 CDN，线上抖动时市场仍可用 last-known-good。
  manifestCacheFile: join(resolveAppDataDir(), 'market-manifest.json'),
})

let gateway: ReturnType<typeof createUiGateway>

// 开发便利：PET_SERVER_HOST / PET_SERVER_PORT 可覆盖监听地址与端口
// （例如 PET_SERVER_HOST=0.0.0.0 让浏览器预览通过局域网 IP 连接）。
const server = createPetServer({
  host: process.env.PET_SERVER_HOST || undefined,
  port: process.env.PET_SERVER_PORT ? Number(process.env.PET_SERVER_PORT) : undefined,
  delegates: {
    [UI_PROTOCOL_PATH]: (socket) => {
      gateway.handleConnection(socket)
    },
  },
})

const controller = createAppController({ server, library, store })
gateway = createUiGateway({ controller, market })

server.start()
  .then(() => {
    const address = server.address()
    console.log(`[desktop-pet] WebSocket server listening on ws://${server.host}:${address?.port ?? server.port}${server.path}`)
    console.log(`[desktop-pet] UI control channel on ws://${server.host}:${address?.port ?? server.port}${UI_PROTOCOL_PATH}`)
    // 确保 DSH 桥接插件已安装（自动，非阻塞；失败不影响服务）。
    void ensureBridgePlugin()
  })
  .catch((error) => {
    console.error('[desktop-pet] failed to start WebSocket server', error)
    process.exitCode = 1
  })

function shutdown(): void {
  console.log('[desktop-pet] shutting down')
  void server.stop()
    .then(() => {
      gateway.stop()
      process.exit(0)
    })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
