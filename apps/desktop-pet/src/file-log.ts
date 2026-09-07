/**
 * pet server 文件日志：把 console 输出 tee 到磁盘。
 *
 * 服务端日志原本只进 stdout——是否留痕完全取决于启动方式（nohup 重定向与否）。
 * 统一 tee 到 ~/.dsh/logs/pet-server.log（PET_SERVER_LOG 可指定路径或关闭），
 * 与桥接插件的 pet-bridge.log 同目录，排障时可对照查看全链路时间线。
 *
 * 说明：桥接插件（plugins/pet）是独立发布包，不能反向依赖本应用代码，
 * 因此两侧各有一份等价的小实现（串行追加、超限轮转、失败静默）。
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const LOG_MAX_BYTES = 2 * 1024 * 1024
const LOG_ROTATE_CHECK_MS = 60_000
const LOG_LINE_MAX = 4000

/** 安全序列化日志附加参数：Error 取 stack 前几行（压成单行）、ErrorEvent 取 type/message、普通对象 JSON。 */
export function formatLogArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    const stack = typeof value.stack === 'string' && value.stack !== ''
      ? value.stack.split('\n').slice(0, 4).join(' | ')
      : ''
    return stack || `${value.name}: ${value.message}`
  }
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>
    // ErrorEvent/Event 形状的对象：JSON.stringify 会丢 message/error 字段
    const eventLike = (typeof v.type === 'string' && typeof v.message === 'string') || v.error instanceof Error
    if (eventLike) {
      const inner = v.error instanceof Error ? `, error=${formatLogArg(v.error)}` : ''
      const name = typeof v.constructor === 'function' && v.constructor.name ? v.constructor.name : 'Event'
      const type = typeof v.type === 'string' ? v.type : ''
      const message = typeof v.message === 'string' ? v.message : ''
      return `${name}(type=${type}${message ? `, message=${message}` : ''}${inner})`
    }
    try { return JSON.stringify(value) } catch { return Object.prototype.toString.call(value) }
  }
  return String(value)
}

export interface FileLog {
  readonly path: string
  /** 追加一行（异步串行，绝不抛错）；测试用 flush() 等待落盘。 */
  append(line: string): void
  flush(): Promise<void>
}

/** 串行追加、超限轮转（保留一份 .old）、任何失败静默——日志绝不影响服务本身。 */
export function createFileLog(
  path: string | null | undefined,
  options: { maxBytes?: number; rotateCheckMs?: number } = {},
): FileLog | null {
  if (typeof path !== 'string' || path === '') return null
  const { maxBytes = LOG_MAX_BYTES, rotateCheckMs = LOG_ROTATE_CHECK_MS } = options
  let queue: Promise<void> = Promise.resolve()
  let lastRotateCheck = 0
  const append = (line: string): void => {
    queue = queue.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        const now = Date.now()
        if (now - lastRotateCheck >= rotateCheckMs) {
          lastRotateCheck = now
          try {
            const info = await stat(path)
            if (info.size >= maxBytes) await rename(path, `${path}.old`)
          } catch {
            /* 文件尚不存在，属首写 */
          }
        }
        await appendFile(path, `${line}\n`)
      } catch {
        /* 日志失败绝不影响服务 */
      }
    })
  }
  return { append, path, flush: () => queue }
}

/**
 * 解析日志文件路径：env PET_SERVER_LOG（'0'/'false'/'' 关闭、'1'/'true' 或缺省用默认路径、
 * 其他字符串为路径）。默认路径 ~/.dsh/logs/pet-server.log。
 */
export function resolveServerLogFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.PET_SERVER_LOG
  if (value === '0' || value === 'false' || value === '') return null
  if (value !== undefined && value !== '1' && value !== 'true') return value
  return join(homedir(), '.dsh', 'logs', 'pet-server.log')
}

const teeMarker = Symbol.for('dsh-pet.console-tee')

function isTeeWrapped(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[teeMarker] === true
}

/**
 * 把 console.log/warn/error tee 到文件日志（原控制台行为保持不变；幂等，重复调用无副作用）。
 * 仅由进程入口（server-entry）调用，包裹整个进程的全部 console 输出。
 */
export function teeConsole(log: FileLog): void {
  const wrap = (method: 'log' | 'warn' | 'error'): void => {
    const original = console[method].bind(console) as (...args: unknown[]) => void
    if (isTeeWrapped(console[method])) return
    const wrapped = (...args: unknown[]): void => {
      original(...args)
      const detail = args.map(formatLogArg).join(' ')
      log.append(`[${new Date().toISOString()}] ${detail}`.slice(0, LOG_LINE_MAX))
    }
    ;(wrapped as unknown as Record<symbol, unknown>)[teeMarker] = true
    console[method] = wrapped
  }
  wrap('log')
  wrap('warn')
  wrap('error')
}
