/**
 * Plugin update-check pure logic.
 *
 * Fetches dist-tags.latest from an npm registry and compares it with the
 * current version. The fetch implementation is injected by the caller for
 * testability.
 */

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
export const DEFAULT_TIMEOUT_MS = 8000

export interface Version {
  major: number
  minor: number
  patch: number
}

export function parseVersion(value: unknown): Version | null {
  if (typeof value !== 'string') return null
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  if (m === null) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

export function compareVersions(a: unknown, b: unknown): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa === null || pb === null) return null
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

export interface CheckForUpdateOptions {
  current: string
  packageName: string
  registry?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface CheckForUpdateResult {
  ok: boolean
  error?: string
  current?: string
  latest?: string
  hasUpdate?: boolean
  sameVersion?: boolean
  invalidCurrent?: boolean
}

export async function checkForUpdate(options: CheckForUpdateOptions): Promise<CheckForUpdateResult> {
  const {
    current,
    packageName,
    registry = DEFAULT_REGISTRY,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options || {} as CheckForUpdateOptions
  if (typeof current !== 'string' || current === '' ||
      typeof packageName !== 'string' || packageName === '') {
    return { ok: false, error: '参数不完整' }
  }
  const base = String(registry).replace(/\/+$/, '')
  const url = `${base}/${encodeURIComponent(packageName)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } })
  } catch (error) {
    return { ok: false, error: '网络请求失败: ' + (error instanceof Error ? error.message : String(error)) }
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    return { ok: false, error: `registry 返回 ${response.status}` }
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { ok: false, error: 'registry 响应不是合法 JSON' }
  }
  const obj = data as { 'dist-tags'?: Record<string, unknown> } | null
  const latest = obj !== null && typeof obj === 'object' && obj['dist-tags'] !== null &&
    typeof obj['dist-tags'] === 'object'
    ? obj['dist-tags'].latest
    : undefined
  if (typeof latest !== 'string' || latest === '') {
    return { ok: false, error: 'registry 响应缺少 dist-tags.latest' }
  }
  const compared = compareVersions(latest, current)
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compared === 1,
    sameVersion: compared === 0,
    invalidCurrent: compared === null,
  }
}
