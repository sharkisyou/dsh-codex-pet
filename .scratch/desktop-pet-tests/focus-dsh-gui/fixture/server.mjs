import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
const server = createServer((req, res) => {
  const name = (req.url ?? '/').split('?')[0].replace(/^\//, '') || 'dsh.html'
  try {
    const body = readFileSync(join(dir, name))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('not found')
  }
})
server.listen(3099, '0.0.0.0', () => console.log('fixture server on http://127.0.0.1:3099/'))
