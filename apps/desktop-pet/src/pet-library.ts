/**
 * Read-only Codex pet library access.
 *
 * The desktop pet reads the same pet packages that Codex uses from
 * `~/.codex/pets/`. This module only lists and loads packages; it never
 * copies, imports, moves, or deletes anything in the Codex library.
 *
 * The filesystem is dependency-injectable so the library logic can be tested
 * with temporary directories or in-memory filesystems.
 */

import {
  assessPackageDir,
  bytesToBase64,
  imageDims,
  parsePetJson,
  spriteMime,
  IMAGE_EXTS,
  type ParsedPet,
} from '@yshark/pet-core'

/** Standard Codex pet atlas cell size (8 columns per spritesheet row). */
export const CELL_W = 192
export const CELL_H = 208
export const DEFAULT_MAX_SPRITE_BYTES = 25 * 1024 * 1024
export const DEFAULT_CODEX_PETS_SUBPATH = '.codex/pets'

/** Internal UI/home environment override name for tests/power users. */
export const PET_LIBRARY_DIR_ENV = 'DSH_PET_LIBRARY_DIR'

export interface PetLibraryEntry {
  id: string
  displayName: string
  description: string
  /** 宠物包所在目录名（如 `itachi-2`），用于区分同名宠物。 */
  sourceDir: string
}

export interface LoadedPetPackage {
  id: string
  pet: ParsedPet
  atlasRows: number
  /** 整张 sprite 的 data URL（含 mime 与 base64，可直接给 DOM/Canvas 渲染）。 */
  spriteDataUrl: string
}

/** 图集原始字节 + 尺寸（缩略图生成用；不含 base64 与动画解析）。 */
export interface PetSpriteBuffer {
  id: string
  spriteName: string
  petJsonText: string
  bytes: Uint8Array
  mime: string
  width: number
  height: number
  atlasRows: number
}

export type PetLibraryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export interface PetDirectoryEntryLike {
  name: string
  isDirectory(): boolean
}

export interface PetFileSystemLike {
  readdir(path: string, options?: { withFileTypes?: boolean }): Promise<PetDirectoryEntryLike[] | string[]>
  readFile(path: string): Promise<Uint8Array | Buffer | string>
  stat?(path: string): Promise<{ size: number }>
}

export interface PetLibraryOptions {
  /** Absolute path to the Codex pets directory. Defaults to `~/.codex/pets`. */
  root?: string
  /** Home directory override. Useful for tests / cross-platform resolution. */
  home?: string | null
  /** Filesystem adapter. Defaults to `node:fs/promises`. */
  fs?: PetFileSystemLike
  /** Maximum spritesheet size in bytes. */
  maxSpriteBytes?: number
}

export interface PetLibrary {
  readonly root: string
  listPets(): Promise<PetLibraryResult<PetLibraryEntry[]>>
  loadPet(id: string): Promise<PetLibraryResult<LoadedPetPackage>>
  /** 只读图集原始字节（缩略图生成用，不转 base64、不解析动画）。 */
  loadSpriteBuffer(id: string): Promise<PetLibraryResult<PetSpriteBuffer>>
  hasPet(id: string): Promise<boolean>
}

export function isSafePetId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return false
  if (id === '.' || id === '..') return false
  if (id.startsWith('.') || id.includes('/') || id.includes('\\')) return false
  return /^[A-Za-z0-9._-]+$/.test(id)
}

export function isSafeSpriteName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0) return false
  if (name === '.' || name === '..') return false
  if (name.startsWith('.') || name.includes('/') || name.includes('\\')) return false
  return true
}

export function defaultLibraryRoot(home: string | null | undefined): string {
  const base = home || (typeof process !== 'undefined' ? process.env.HOME || process.env.USERPROFILE : '') || ''
  return base ? `${base}/${DEFAULT_CODEX_PETS_SUBPATH}` : ''
}

export function resolveLibraryRoot(options: PetLibraryOptions = {}): string {
  if (options.root && options.root.trim() !== '') return options.root
  if (typeof process !== 'undefined') {
    const envRoot = process.env[PET_LIBRARY_DIR_ENV]
    if (envRoot && envRoot.trim() !== '') return envRoot
  }
  return defaultLibraryRoot(options.home ?? (typeof process !== 'undefined' ? process.env.HOME || process.env.USERPROFILE : undefined))
}

async function defaultFs(): Promise<PetFileSystemLike> {
  // Loaded lazily so browser/Vite builds do not pull Node's filesystem API into
  // the frontend bundle.
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const fs = require('node:fs/promises') as typeof import('node:fs/promises')
  return {
    async readdir(path, options) {
      return (await fs.readdir(path, { withFileTypes: true })) as unknown as PetDirectoryEntryLike[]
    },
    async readFile(path) {
      return fs.readFile(path)
    },
    async stat(path) {
      return fs.stat(path)
    },
  }
}
function listError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function decodeText(value: Uint8Array | Buffer | string): string {
  if (typeof value === 'string') return value
  return new TextDecoder().decode(value)
}

export function createPetLibrary(options: PetLibraryOptions = {}): PetLibrary {
  const root = resolveLibraryRoot(options)
  const maxSpriteBytes = options.maxSpriteBytes ?? DEFAULT_MAX_SPRITE_BYTES
  const fsPromise = options.fs
    ? Promise.resolve(options.fs)
    : defaultFs()

  async function withFs<T>(fn: (fs: PetFileSystemLike) => Promise<T>): Promise<T> {
    return fn(await fsPromise)
  }

  async function listPets(): Promise<PetLibraryResult<PetLibraryEntry[]>> {
    try {
      return await withFs(async (fs) => {
        let entries: PetDirectoryEntryLike[]
        try {
          const raw = await fs.readdir(root, { withFileTypes: true })
          entries = (raw ?? []) as PetDirectoryEntryLike[]
        } catch (error) {
          const code = (error as { code?: string }).code
          if (code === 'ENOENT') return { ok: true, value: [] }
          throw error
        }

        const dirs = entries
          .filter((entry): entry is PetDirectoryEntryLike =>
            typeof entry === 'object' && entry !== null && typeof entry.isDirectory === 'function' && entry.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name))

        const pets: PetLibraryEntry[] = []
        for (const entry of dirs) {
          const id = entry.name
          if (!isSafePetId(id)) continue
          try {
            const files = await fs.readdir(`${root}/${id}`)
            const fileNames = files.map((f) => typeof f === 'string' ? f : f.name)
            const assessed = assessPackageDir(fileNames)
            if (!assessed.valid) continue
            const text = decodeText(await fs.readFile(`${root}/${id}/pet.json`))
            const petJson = JSON.parse(text) as Record<string, unknown>
            const displayName = typeof petJson.displayName === 'string' && petJson.displayName !== ''
              ? petJson.displayName
              : id
            const description = typeof petJson.description === 'string' ? petJson.description : ''
            pets.push({ id, displayName, description, sourceDir: id })
          } catch {
            // A damaged package should not prevent the other pets from listing.
          }
        }
        return { ok: true, value: pets }
      })
    } catch (error) {
      return { ok: false, error: `读取宠物库失败: ${listError(error)}` }
    }
  }

  /**
   * 图集读取的公共部分：定位宠物包 → 校验 → 读出原始字节与尺寸。
   * 校验失败以 `ok:false` 返回（错误文案与历史一致），IO 错误照常抛出。
   */
  async function readSprite(fs: PetFileSystemLike, id: string): Promise<PetLibraryResult<PetSpriteBuffer>> {
    const dir = `${root}/${id}`
    const files = await fs.readdir(dir)
    const fileNames = files.map((f) => typeof f === 'string' ? f : f.name)
    const assessed = assessPackageDir(fileNames)
    if (!assessed.valid) {
      return { ok: false, error: assessed.reason ?? '宠物包不完整' }
    }

    const text = decodeText(await fs.readFile(`${dir}/pet.json`))
    const rawJson = JSON.parse(text) as Record<string, unknown>
    const rawSpriteName = typeof rawJson.spritesheetPath === 'string' && rawJson.spritesheetPath !== ''
      ? rawJson.spritesheetPath
      : fileNames.find((name) => IMAGE_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) ?? ''
    if (!isSafeSpriteName(rawSpriteName)) return { ok: false, error: '非法图集路径' }
    const spriteName = rawSpriteName
    if (spriteName === '') return { ok: false, error: '缺少图集文件' }

    const spritePath = `${dir}/${spriteName}`
    const bytes = await fs.readFile(spritePath)
    const byteLength = typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength ?? bytes.length
    if (byteLength > maxSpriteBytes) {
      return { ok: false, error: '图集文件过大' }
    }
    const uint8 = typeof bytes === 'string'
      ? new TextEncoder().encode(bytes)
      : (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayLike<number>))
    const dims = imageDims(uint8)
    if (dims === null) return { ok: false, error: '图集不是支持的图片格式（PNG/WebP）' }
    if (dims.width % CELL_W !== 0 || dims.height % CELL_H !== 0 || dims.width / CELL_W !== 8) {
      return { ok: false, error: `图集尺寸不支持: ${dims.width}x${dims.height}` }
    }
    const atlasRows = Math.floor(dims.height / CELL_H)
    if (atlasRows <= 0) return { ok: false, error: '图集行数无效' }

    return {
      ok: true,
      value: {
        id,
        spriteName,
        petJsonText: text,
        bytes: uint8,
        mime: spriteMime(spriteName),
        width: dims.width,
        height: dims.height,
        atlasRows,
      },
    }
  }

  async function loadPet(id: string): Promise<PetLibraryResult<LoadedPetPackage>> {
    if (!isSafePetId(id)) return { ok: false, error: '非法宠物 id' }
    try {
      return await withFs(async (fs) => {
        const sprite = await readSprite(fs, id)
        if (!sprite.ok) return sprite
        const parsed = parsePetJson(sprite.value.petJsonText, sprite.value.atlasRows)
        if (!parsed.ok) return { ok: false, error: parsed.errors.join('; ') }
        const base64 = bytesToBase64(sprite.value.bytes)
        return {
          ok: true,
          value: {
            id,
            pet: parsed.pet,
            atlasRows: sprite.value.atlasRows,
            spriteDataUrl: `data:${sprite.value.mime};base64,${base64}`,
          },
        }
      })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ENOENT') return { ok: false, error: '宠物不存在' }
      return { ok: false, error: `读取宠物失败: ${listError(error)}` }
    }
  }

  /**
   * 只读图集原始字节（**不**转 base64、**不**解析动画、不进 controller 的
   * 整张精灵 LRU）。缩略图生成走这条路，避免为了 96×104 的小图把 ~11MB 的
   * 整图解进内存。
   */
  async function loadSpriteBuffer(id: string): Promise<PetLibraryResult<PetSpriteBuffer>> {
    if (!isSafePetId(id)) return { ok: false, error: '非法宠物 id' }
    try {
      return await withFs((fs) => readSprite(fs, id))
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'ENOENT') return { ok: false, error: '宠物不存在' }
      return { ok: false, error: `读取宠物失败: ${listError(error)}` }
    }
  }

  async function hasPet(id: string): Promise<boolean> {
    const result = await loadPet(id)
    return result.ok
  }

  return {
    root,
    listPets,
    loadPet,
    loadSpriteBuffer,
    hasPet,
  }
}
