/**
 * 在线宠物市场（petdex.dev）访问模块 —— 仅 Node 侧。
 *
 * 职责：
 * - 拉取并缓存市场 manifest（默认 https://assets.petdex.dev/manifests/petdex-v1.json）
 * - 列出/搜索宠物
 * - 下载宠物包（zip 或 pet.json + spritesheet）并安装到 ~/.codex/pets/<slug>/
 *
 * 安装会写入文件系统：这是用户明确的安装动作，与 pet-library 的"只读列出"
 * 定位不同。安装前会用 @yshark/pet-core 校验 pet.json，失败则回滚。
 */

import { createRequire } from 'node:module'
import { parsePetJson, type ParsedPet } from '@yshark/pet-core'
import sharp from 'sharp'

import type { MarketInstallResult, MarketManifest, MarketPet } from './market-types.js'

const require = createRequire(import.meta.url)
// adm-zip 是 CommonJS 包；延迟 require，避免浏览器打包时被拉进来。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require('adm-zip') as new (buffer: Buffer) => { extractAllTo(target: string, overwrite: boolean): void }

/**
 * petdex manifest 直连地址（新域名）。旧地址 `https://petdex.crafter.run/api/manifest`
 * 已 308 迁移到这里；`https://petdex.dev/api/manifest` 也 307 指向同一文件。
 * 直连 assets 域名省去一跳重定向，且 manifest 与单宠物资源（sprite/petjson/zip）
 * 都托管在 assets.petdex.dev。
 */
export const DEFAULT_MANIFEST_URL = 'https://assets.petdex.dev/manifests/petdex-v1.json'
export const DEFAULT_USER_AGENT = 'dsh-pet-market/1.0'
/** manifest 缓存时长：petdex 宠物变动不频繁，48 小时刷新一次足够。 */
export const DEFAULT_CACHE_TTL_MS = 48 * 60 * 60 * 1000
export const DEFAULT_MAX_SPRITE_BYTES = 25 * 1024 * 1024
export const DEFAULT_MAX_ZIP_BYTES = 50 * 1024 * 1024
/**
 * 单次下载超时。petdex sprite 单个 1.2~3.2MB，页面渲染会并发请求 ~27 张；
 * 在 CDN 突发下 20s 经常被打穿（曾实测单张 20.1s 后才完成），3 次重试全部
 * 超时会直接导致「缩略图生成失败」。放宽到 60s 后同场景实测 0 失败。
 */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60000
/**
 * 下载信号量上限：限制并发整图下载，避免页面首屏 27 张 2MB 并发打爆 CDN 连接。
 * 实测（同时间窗 6/12/27 对比，27 张/页）：12 并发最快且失败率极低，
 * 27 并发没有更快（网络/CDN 是瓶颈）还带来连接被断/限流的风险。
 */
export const DEFAULT_DOWNLOAD_CONCURRENCY = 12
export const DEFAULT_ATLAS_ROWS = 9

export interface MarketListFilter {
  query?: string
  kind?: string
  /** 页码（从 1 开始）。 */
  page?: number
  /** 每页数量。默认 24，上限 100。 */
  pageSize?: number
}

export interface MarketListResult {
  pets: MarketPet[]
  /** 过滤后的总数（用于分页）。 */
  total: number
}

export interface MarketListOptions extends MarketListFilter {
  /** 兼容旧调用：无分页时返回前 N 条（等价 page=1&pageSize=limit）。 */
  limit?: number
}

export interface MarketOptions {
  /** manifest 地址。默认 petdex API。 */
  manifestUrl?: string
  userAgent?: string
  cacheTtlMs?: number
  /** 宠物安装根目录。默认 ~/.codex/pets。 */
  installRoot?: string
  /** home 覆盖（用于测试 / 跨平台解析）。 */
  home?: string | null
  /** fetch 实现注入（测试用）。默认全局 fetch。 */
  fetchImpl?: typeof fetch
  maxSpriteBytes?: number
  maxZipBytes?: number
  downloadTimeoutMs?: number
  /** 并发下载上限（默认 12）。页面首屏一次并发请求 ~27 张缩略图，不限制会打爆 CDN。 */
  downloadConcurrency?: number
  /**
   * manifest 磁盘缓存文件路径。服务重启/网络抖动时，市场列表仍可用
   * （last-known-good，带 TTL；线上失败时回退过期缓存并告警）。
   */
  manifestCacheFile?: string
}

export interface Market {
  listPets(filter?: MarketListFilter): Promise<MarketListResult>
  /** manifest 中全部宠物类型（去重、排序），用于筛选下拉。 */
  listKinds(): Promise<string[]>
  installPet(pet: MarketPet): Promise<MarketInstallResult>
  /** 卸载本地宠物：删除 ~/.codex/pets/<slug>/ 目录。 */
  uninstallPet(slug: string): Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * 生成宠物缩略图（sprite 首帧裁剪），返回 data URL；失败返回 null。
   * 缩略图由服务端下载并缓存，前端不直接访问 petdex CDN。
   */
  getThumbnail(pet: MarketPet): Promise<string | null>
  /**
   * 获取宠物详情：解析后的 pet（可能为 null，前端用标准动画兜底）
   * 与整张 sprite 的 data URL（用于大图动画预览）。
   */
  getPetDetail(pet: MarketPet): Promise<{ pet: ParsedPet | null; spriteDataUrl: string | null }>
  clearCache(): void
}

/** slug 安全化：只保留 [a-z0-9-_]，拒绝空值与路径穿越。 */
export function safeSlug(slug: string): string {
  const cleaned = String(slug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '..' || cleaned.includes('..')) return ''
  return cleaned
}

export function basenameOf(path: string): string {
  return String(path).split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export function createMarket(options: MarketOptions = {}): Market {
  const manifestUrl = options.manifestUrl ?? DEFAULT_MANIFEST_URL
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const maxSpriteBytes = options.maxSpriteBytes ?? DEFAULT_MAX_SPRITE_BYTES
  const maxZipBytes = options.maxZipBytes ?? DEFAULT_MAX_ZIP_BYTES
  const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS
  const downloadConcurrency = Math.max(1, options.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY)
  const manifestCacheFile = options.manifestCacheFile ?? ''
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const home = options.home !== undefined ? options.home : (typeof process !== 'undefined' ? process.env.HOME : null)
  const installRoot = options.installRoot ?? (home ? `${home}/.codex/pets` : '')

  let cachedManifest: MarketManifest | null = null
  let cachedAt = 0
  // 图片类缓存带 LRU 上限，防止预取/翻页导致无限增长（曾触发 JS OOM）：
  // sprite 全量（2-3MB/张）上限 60 张 ≈ 180MB；详情（~2.9MB base64/条）上限 20 条；
  // 缩略图（~9KB/张）较小，上限 2000 张。
  const SPRITE_CACHE_MAX = 60
  const PET_DETAIL_CACHE_MAX = 20
  const THUMB_CACHE_MAX = 2000
  const spriteCache = new Map<string, Buffer>()
  const thumbCache = new Map<string, string>()
  const petDetailCache = new Map<string, { pet: ParsedPet | null; spriteDataUrl: string | null }>()

  function getSprite(slug: string): Buffer | undefined {
    const value = spriteCache.get(slug)
    if (value !== undefined) {
      spriteCache.delete(slug)
      spriteCache.set(slug, value) // 刷新 LRU 顺序
    }
    return value
  }

  function putSprite(slug: string, buffer: Buffer): void {
    spriteCache.delete(slug)
    spriteCache.set(slug, buffer)
    while (spriteCache.size > SPRITE_CACHE_MAX) {
      const oldest = spriteCache.keys().next().value
      if (oldest === undefined) break
      spriteCache.delete(oldest)
    }
  }

  function cachePetDetail(slug: string, value: { pet: ParsedPet | null; spriteDataUrl: string | null }): void {
    petDetailCache.delete(slug)
    petDetailCache.set(slug, value)
    while (petDetailCache.size > PET_DETAIL_CACHE_MAX) {
      const oldest = petDetailCache.keys().next().value
      if (oldest === undefined) break
      petDetailCache.delete(oldest)
    }
  }

  function cacheThumb(slug: string, dataUrl: string): void {
    thumbCache.delete(slug)
    thumbCache.set(slug, dataUrl)
    while (thumbCache.size > THUMB_CACHE_MAX) {
      const oldest = thumbCache.keys().next().value
      if (oldest === undefined) break
      thumbCache.delete(oldest)
    }
  }

  async function fsModule(): Promise<typeof import('node:fs/promises')> {
    return require('node:fs/promises') as typeof import('node:fs/promises')
  }

  // 下载信号量：把并发整图下载限制在 downloadConcurrency 内。
  // 页面首屏会一次性发出 ~27 张缩略图请求，若全部同时下载 2MB 级 sprite，
  // CDN 会终止部分连接（实测 "terminated" / "fetch failed"）。
  let activeDownloads = 0
  const downloadWaiters: Array<() => void> = []

  async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (activeDownloads >= downloadConcurrency) {
      await new Promise<void>((resolve) => downloadWaiters.push(resolve))
    }
    activeDownloads++
    try {
      return await fn()
    } finally {
      activeDownloads--
      downloadWaiters.shift()?.()
    }
  }

  function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600)
  }

  /**
   * 带超时+重试的请求解码（headers 与 body 都受超时保护）。
   * consume 在定时器生效期间运行，body 中途停滞同样触发 abort。
   */
  async function fetchRetryDecode<T>(
    url: string,
    consume: (response: Response) => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), downloadTimeoutMs)
      try {
        const response = await fetchImpl(url, {
          headers: { 'User-Agent': userAgent },
          signal: controller.signal,
          redirect: 'follow',
        })
        // 网络/代理抖动或 CDN 突发：429/5xx 也值得退避重试（404 等直接走 consume 的失败分支）。
        if (!response.ok && isRetryableStatus(response.status)) {
          lastError = new Error(`HTTP ${response.status}`)
        } else {
          return await consume(response)
        }
      } catch (error) {
        lastError = error
      } finally {
        clearTimeout(timer)
      }
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  async function fetchRetry(url: string, attempts = 3): Promise<Response> {
    return fetchRetryDecode(url, (response) => Promise.resolve(response), attempts)
  }

  async function download(url: string, maxBytes: number): Promise<Buffer> {
    return withDownloadSlot(() =>
      fetchRetryDecode(url, async (response) => {
        if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.byteLength > maxBytes) {
          throw new Error(`文件过大: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`)
        }
        return buffer
      }),
    )
  }

  async function loadManifestFromDisk(): Promise<{ manifest: MarketManifest; savedAt: number } | null> {
    if (!manifestCacheFile) return null
    try {
      const fs = await fsModule()
      const text = await fs.readFile(manifestCacheFile, 'utf8')
      const data = JSON.parse(text) as { savedAt?: number; manifest?: MarketManifest }
      if (typeof data.savedAt !== 'number' || !data.manifest || !Array.isArray(data.manifest.pets)) return null
      return { manifest: data.manifest, savedAt: data.savedAt }
    } catch {
      return null // 文件不存在/损坏 → 当作没有磁盘缓存
    }
  }

  async function saveManifestToDisk(manifest: MarketManifest): Promise<void> {
    if (!manifestCacheFile) return
    try {
      const fs = await fsModule()
      const path = require('node:path') as typeof import('node:path')
      await fs.mkdir(path.dirname(manifestCacheFile), { recursive: true })
      // 原子写：先写临时文件再改名，避免进程中断留下半写文件。
      await fs.writeFile(`${manifestCacheFile}.tmp`, JSON.stringify({ savedAt: Date.now(), manifest }), 'utf8')
      await fs.rename(`${manifestCacheFile}.tmp`, manifestCacheFile)
    } catch (error) {
      console.warn(`[market] manifest 磁盘缓存写入失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function loadManifest(): Promise<MarketManifest> {
    if (cachedManifest !== null && Date.now() - cachedAt < cacheTtlMs) return cachedManifest
    const disk = await loadManifestFromDisk()
    // 磁盘缓存未过期：免网络，重启后市场页秒开。
    if (disk && Date.now() - disk.savedAt < cacheTtlMs) {
      cachedManifest = disk.manifest
      cachedAt = disk.savedAt
      return cachedManifest
    }
    try {
      const response = await fetchRetry(manifestUrl)
      if (!response.ok) throw new Error(`manifest 拉取失败: HTTP ${response.status}`)
      const data = (await response.json()) as Partial<MarketManifest>
      if (!Array.isArray(data.pets)) throw new Error('manifest 格式不正确：缺少 pets 数组')
      cachedManifest = { generatedAt: String(data.generatedAt ?? ''), total: data.pets.length, pets: data.pets }
      cachedAt = Date.now()
      await saveManifestToDisk(cachedManifest)
      return cachedManifest
    } catch (error) {
      // 线上失败：回退到磁盘上的 last-known-good（即便已过期，也比"市场不可用"强）。
      if (disk) {
        console.warn(`[market] manifest 线上拉取失败，使用磁盘缓存: ${error instanceof Error ? error.message : String(error)}`)
        cachedManifest = disk.manifest
        cachedAt = disk.savedAt
        return cachedManifest
      }
      throw error
    }
  }

  function matches(pet: MarketPet, query: string): boolean {
    if (!query) return true
    return [
      pet.displayName,
      pet.slug,
      pet.submittedBy ?? '',
      pet.kind ?? '',
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
  }

  async function listPets(filter: MarketListFilter = {}): Promise<MarketListResult> {
    const manifest = await loadManifest()
    const query = String(filter.query ?? '').trim().toLowerCase()
    const kind = String(filter.kind ?? '').trim().toLowerCase()
    let pets = manifest.pets.filter((pet) => matches(pet, query))
    if (kind) pets = pets.filter((pet) => String(pet.kind ?? '').toLowerCase() === kind)
    const total = pets.length
    const pageSize = Math.min(Math.max(Number(filter.pageSize ?? 24) || 24, 1), 100)
    const page = Math.max(Number(filter.page ?? 1) || 1, 1)
    const start = (page - 1) * pageSize
    return { pets: pets.slice(start, start + pageSize), total }
  }

  async function installFromAssets(pet: MarketPet, tmpDir: string): Promise<void> {
    const fs = await fsModule()
    if (!pet.petJsonUrl || !pet.spritesheetUrl) throw new Error('条目缺少 petJsonUrl 或 spritesheetUrl')
    const manifestBytes = await download(pet.petJsonUrl, maxSpriteBytes)
    const parsed = parsePetJson(manifestBytes.toString('utf8'), DEFAULT_ATLAS_ROWS)
    if (!parsed.ok) throw new Error(`pet.json 校验失败: ${parsed.errors.join('; ')}`)
    // 按 spritesheet 后缀统一文件名，并回写 pet.json 的 spritesheetPath。
    const spriteName = pet.spritesheetUrl.toLowerCase().includes('.png') ? 'spritesheet.png' : 'spritesheet.webp'
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>
    manifest.spritesheetPath = spriteName
    await fs.writeFile(`${tmpDir}/pet.json`, JSON.stringify(manifest, null, 2), 'utf8')
    const spriteBytes = await download(pet.spritesheetUrl, maxSpriteBytes)
    await fs.writeFile(`${tmpDir}/${spriteName}`, spriteBytes)
  }

  async function installFromZip(zipUrl: string, tmpDir: string): Promise<void> {
    const zipBytes = await download(zipUrl, maxZipBytes)
    const zip = new AdmZip(zipBytes)
    zip.extractAllTo(tmpDir, true)
  }

  async function installPet(pet: MarketPet): Promise<MarketInstallResult> {
    const slug = safeSlug(pet.slug)
    if (!slug) return { ok: false, error: '非法宠物 slug' }
    if (!installRoot) return { ok: false, error: '无法解析宠物安装目录' }
    const fs = await fsModule()
    const path = require('node:path') as typeof import('node:path')
    const target = path.join(installRoot, slug)
    const tmp = path.join(installRoot, `.tmp-${slug}-${Date.now()}`)
    try {
      await fs.mkdir(installRoot, { recursive: true })
      await fs.mkdir(tmp, { recursive: true })

      let extracted = false
      if (pet.zipUrl) {
        try {
          await installFromZip(pet.zipUrl, tmp)
          extracted = true
        } catch (error) {
          // zip 失败时若仍有单文件资产则回退；否则直接抛出。
          if (!pet.petJsonUrl || !pet.spritesheetUrl) throw error
        }
      }
      if (!extracted) await installFromAssets(pet, tmp)

      // 校验：pet.json 必须可解析，且引用的 spritesheet 存在。
      const manifestText = await fs.readFile(`${tmp}/pet.json`, 'utf8')
      const parsed = parsePetJson(manifestText, DEFAULT_ATLAS_ROWS)
      if (!parsed.ok) throw new Error(`pet.json 校验失败: ${parsed.errors.join('; ')}`)
      const spriteName = basenameOf(parsed.pet.spritesheetPath)
      const spriteStat = await fs.stat(`${tmp}/${spriteName}`)
      if (spriteStat.size <= 0) throw new Error('spritesheet 为空文件')

      // 覆盖式安装：先清掉旧目录再移入。
      try {
        await fs.rm(target, { recursive: true, force: true })
      } catch { /* 不存在则忽略 */ }
      await fs.rename(tmp, target)
      return {
        ok: true,
        value: { id: parsed.pet.id, displayName: parsed.pet.displayName, sourceDir: target },
      }
    } catch (error) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => { /* ignore */ })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function getThumbnail(pet: MarketPet): Promise<string | null> {
    if (!pet.spritesheetUrl) return null
    const cached = thumbCache.get(pet.slug)
    if (cached) return cached
    try {
      let sprite = getSprite(pet.slug)
      if (!sprite) {
        sprite = await download(pet.spritesheetUrl, maxSpriteBytes)
        putSprite(pet.slug, sprite)
      }
      // 裁出 sprite 首帧（左上 192x208）并缩到 96x104，转 webp 减小体积。
      // 小尺寸/非标准 sprite 兜底为整体裁剪，避免 extract 越界导致整张失败。
      const meta = await sharp(sprite).metadata()
      const frameWidth = Math.min(192, meta.width ?? 192)
      const frameHeight = Math.min(208, meta.height ?? 208)
      const thumb = await sharp(sprite)
        .extract({ left: 0, top: 0, width: frameWidth, height: frameHeight })
        .resize(96, 104, { fit: 'fill' })
        .webp({ quality: 82 })
        .toBuffer()
      const dataUrl = `data:image/webp;base64,${thumb.toString('base64')}`
      cacheThumb(pet.slug, dataUrl)
      return dataUrl
    } catch (error) {
      console.warn(`[market] thumbnail failed for ${pet.slug}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  async function listKinds(): Promise<string[]> {
    const manifest = await loadManifest()
    const kinds = new Set<string>()
    for (const pet of manifest.pets) {
      if (pet.kind) kinds.add(pet.kind)
    }
    return [...kinds].sort((a, b) => a.localeCompare(b))
  }

  async function uninstallPet(slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const safe = safeSlug(slug)
    if (!safe) return { ok: false, error: '非法宠物 slug' }
    if (!installRoot) return { ok: false, error: '无法解析宠物安装目录' }
    const fs = await fsModule()
    const path = require('node:path') as typeof import('node:path')
    const target = path.join(installRoot, safe)
    try {
      await fs.rm(target, { recursive: true, force: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function getPetDetail(pet: MarketPet): Promise<{ pet: ParsedPet | null; spriteDataUrl: string | null }> {
    const cached = petDetailCache.get(pet.slug)
    if (cached) return cached
    let parsed: ParsedPet | null = null
    if (pet.petJsonUrl) {
      try {
        const bytes = await download(pet.petJsonUrl, maxSpriteBytes)
        const result = parsePetJson(bytes.toString('utf8'), DEFAULT_ATLAS_ROWS)
        if (result.ok) parsed = result.pet
      } catch { /* 解析失败时前端用标准动画兜底 */ }
    }
    let spriteDataUrl: string | null = null
    if (pet.spritesheetUrl) {
      try {
        let sprite = getSprite(pet.slug)
        if (!sprite) {
          sprite = await download(pet.spritesheetUrl, maxSpriteBytes)
          putSprite(pet.slug, sprite)
        }
        const mime = pet.spritesheetUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/webp'
        spriteDataUrl = `data:${mime};base64,${sprite.toString('base64')}`
      } catch { /* ignore */ }
    }
    const value = { pet: parsed, spriteDataUrl }
    cachePetDetail(pet.slug, value)
    return value
  }

  return {
    listPets,
    listKinds,
    installPet,
    uninstallPet,
    getThumbnail,
    getPetDetail,
    clearCache: () => {
      cachedManifest = null
      cachedAt = 0
      spriteCache.clear()
      thumbCache.clear()
      petDetailCache.clear()
    },
  }
}
