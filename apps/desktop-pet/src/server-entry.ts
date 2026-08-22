/**
 * Standalone entry point for the desktop pet WebSocket server.
 *
 * This is useful during development and for tests that want a real Node
 * process accepting bridge connections. The Tauri shell can also spawn this
 * as a sidecar; the server module itself is kept dependency-injectable so the
 * same logic can be exercised without opening a socket.
 */

import { createPetServer } from './server.js'

const server = createPetServer()

server.start()
  .then(() => {
    const address = server.address()
    console.log(`[desktop-pet] WebSocket server listening on ws://${server.host}:${address?.port ?? server.port}${server.path}`)
  })
  .catch((error) => {
    console.error('[desktop-pet] failed to start WebSocket server', error)
    process.exitCode = 1
  })

function shutdown(): void {
  console.log('[desktop-pet] shutting down')
  void server.stop().then(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
