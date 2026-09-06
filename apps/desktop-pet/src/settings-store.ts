/**
 * Persistent desktop-pet settings.
 *
 * The desktop pet stores its own preferences in the application data directory
 * (not in DSH or Codex data). This module is filesystem-injectable so tests
 * can use temporary directories and the same code can run in the Node sidecar.
 */

import { createRequire } from 'node:module'

import {
  DARK_THEME_IDS,
  LANGUAGE_IDS,
  LIGHT_THEME_IDS,
  THEME_MODES,
  type DarkThemeId,
  type LanguageId,
  type LightThemeId,
  type ThemeMode,
} from './app-constants.js'

export type { DarkThemeId, LanguageId, LightThemeId, ThemeId, ThemeMode } from './app-constants.js'
export { DARK_THEME_IDS, LANGUAGE_IDS, LIGHT_THEME_IDS, THEME_MODES } from './app-constants.js'

export interface PetSettings {
  /** Selected pet id from the Codex pet library, or null for no selection. */
  selectedPetId: string | null
  /** Canvas zoom factor. */
  zoom: number
  /** Wake = the pet is visible and follows session state. */
  awake: boolean
  /** Theme mode: follow the OS preference, or pin dark / light. */
  themeMode: ThemeMode
  /** Theme used when the effective appearance is dark. */
  darkTheme: DarkThemeId
  /** Theme used when the effective appearance is light. */
  lightTheme: LightThemeId
  /** UI language: follow the OS, or pin Chinese / English. */
  language: LanguageId
  /** Last pet-window outer X position (physical pixels), or null to use default. */
  windowX?: number | null
  /** Last pet-window outer Y position (physical pixels), or null to use default. */
  windowY?: number | null
}

export const DEFAULT_SETTINGS: PetSettings = Object.freeze({
  selectedPetId: null,
  zoom: 1.2,
  awake: true,
  themeMode: 'system',
  darkTheme: 'graphite',
  lightTheme: 'classic',
  language: 'system',
  windowX: null,
  windowY: null,
})

export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 3
export const SETTINGS_FILE_NAME = 'settings.json'
export const APP_DATA_DIR_NAME = 'dev.yshark.desktop-pet'
export const PET_DATA_DIR_ENV = 'DSH_PET_DATA_DIR'

export interface SettingsFileSystemLike {
  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>
  rename(oldPath: string, newPath: string): Promise<void>
  rm?(path: string, options?: { force?: boolean }): Promise<void>
}

export interface SettingsStoreOptions {
  dataDir?: string
  fileSystem?: SettingsFileSystemLike
  platform?: string
  env?: Record<string, string | undefined>
  home?: string
  defaults?: Partial<PetSettings>
}

export interface SettingsStore {
  readonly dataDir: string
  readonly filePath: string
  load(): Promise<PetSettings>
  save(settings: PetSettings): Promise<void>
  update(patch: Partial<PetSettings>): Promise<PetSettings>
  get(): PetSettings
}

export function clampZoom(value: unknown): number {
  const num = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.zoom
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, num))
}

export function clampThemeMode(value: unknown): ThemeMode {
  return THEME_MODES.includes(value as ThemeMode) ? value as ThemeMode : DEFAULT_SETTINGS.themeMode
}

export function clampDarkTheme(value: unknown): DarkThemeId {
  return DARK_THEME_IDS.includes(value as DarkThemeId) ? value as DarkThemeId : DEFAULT_SETTINGS.darkTheme
}

export function clampLightTheme(value: unknown): LightThemeId {
  return LIGHT_THEME_IDS.includes(value as LightThemeId) ? value as LightThemeId : DEFAULT_SETTINGS.lightTheme
}

export function clampLanguage(value: unknown): LanguageId {
  return LANGUAGE_IDS.includes(value as LanguageId) ? value as LanguageId : DEFAULT_SETTINGS.language
}

export function sanitizeSettings(input: unknown): PetSettings {
  const record = (input !== null && typeof input === 'object' && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {}
  const selectedPetId = typeof record.selectedPetId === 'string' && record.selectedPetId !== ''
    ? record.selectedPetId
    : null
  const rawWindowX = record.windowX ?? record.x
  const rawWindowY = record.windowY ?? record.y
  const windowX = typeof rawWindowX === 'number' && Number.isFinite(rawWindowX)
    ? Math.round(rawWindowX)
    : null
  const windowY = typeof rawWindowY === 'number' && Number.isFinite(rawWindowY)
    ? Math.round(rawWindowY)
    : null
  return {
    selectedPetId,
    zoom: clampZoom(record.zoom),
    awake: typeof record.awake === 'boolean' ? record.awake : DEFAULT_SETTINGS.awake,
    themeMode: clampThemeMode(record.themeMode),
    darkTheme: clampDarkTheme(record.darkTheme),
    lightTheme: clampLightTheme(record.lightTheme),
    language: clampLanguage(record.language),
    windowX,
    windowY,
  }
}

export function resolveAppDataDir(options: SettingsStoreOptions = {}): string {
  if (options.dataDir && options.dataDir.trim() !== '') return options.dataDir
  const processEnv = typeof process !== 'undefined' ? process.env : {} as Record<string, string | undefined>
  const env: Record<string, string | undefined> = { ...processEnv, ...(options.env ?? {}) }
  if (env[PET_DATA_DIR_ENV] && env[PET_DATA_DIR_ENV]!.trim() !== '') {
    return env[PET_DATA_DIR_ENV]!
  }

  const platform = options.platform ?? (typeof process !== 'undefined' ? process.platform : 'linux')
  const home = options.home ?? env?.HOME ?? env?.USERPROFILE ?? ''
  const windows = platform === 'win32'
  const darwin = platform === 'darwin'

  if (windows && env?.APPDATA) return `${env.APPDATA}/${APP_DATA_DIR_NAME}`
  if (darwin) return home ? `${home}/Library/Application Support/${APP_DATA_DIR_NAME}` : ''
  if (env?.XDG_DATA_HOME) return `${env.XDG_DATA_HOME}/${APP_DATA_DIR_NAME}`
  return home ? `${home}/.local/share/${APP_DATA_DIR_NAME}` : ''
}

function defaultFileSystem(): SettingsFileSystemLike {
  // Loaded lazily so the browser bundle never pulls in Node's fs API.
  const require = createRequire(import.meta.url)
  const nodeModule = require('node:fs/promises') as typeof import('node:fs/promises')
  return {
    readFile: (p) => nodeModule.readFile(p, 'utf8'),
    writeFile: (p, data) => nodeModule.writeFile(p, data, 'utf8'),
    mkdir: (p, options) => nodeModule.mkdir(p, options),
    rename: (oldPath, newPath) => nodeModule.rename(oldPath, newPath),
    rm: (p, options) => nodeModule.rm(p, options),
  }
}

export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const dataDir = resolveAppDataDir(options)
  const filePath = `${dataDir}/${SETTINGS_FILE_NAME}`
  const fsPromise = options.fileSystem ? Promise.resolve(options.fileSystem) : Promise.resolve(defaultFileSystem())
  const defaults: PetSettings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(options.defaults ?? null) }
  let cache: PetSettings | null = null

  async function readSettings(): Promise<PetSettings> {
    const fs = await fsPromise
    try {
      const text = await fs.readFile(filePath)
      return sanitizeSettings(JSON.parse(text))
    } catch {
      return { ...defaults }
    }
  }

  async function ensureDir(fs: SettingsFileSystemLike): Promise<void> {
    if (typeof fs.mkdir === 'function') {
      await fs.mkdir(dataDir, { recursive: true })
    }
  }

  async function load(): Promise<PetSettings> {
    if (cache !== null) return cache
    cache = await readSettings()
    return cache
  }

  async function save(settings: PetSettings): Promise<void> {
    cache = sanitizeSettings(settings)
    const fs = await fsPromise
    await ensureDir(fs)
    const tmpPath = `${filePath}.tmp`
    const payload = JSON.stringify(cache, null, 2)
    await fs.writeFile(tmpPath, payload)
    if (typeof fs.rename === 'function') {
      try {
        await fs.rename(tmpPath, filePath)
      } catch {
        // On some platforms (notably Windows) rename may not replace an
        // existing file; remove the old settings file and retry.
        if (typeof fs.rm === 'function') {
          try { await fs.rm(filePath, { force: true }) } catch { /* ignore */ }
          await fs.rename(tmpPath, filePath)
        } else {
          await fs.writeFile(filePath, payload)
        }
      }
    } else {
      await fs.writeFile(filePath, payload)
      if (typeof fs.rm === 'function') await fs.rm(tmpPath, { force: true })
    }
  }

  async function update(patch: Partial<PetSettings>): Promise<PetSettings> {
    const current = await load()
    const next = sanitizeSettings({ ...current, ...patch })
    await save(next)
    return next
  }

  return {
    dataDir,
    filePath,
    load,
    save,
    update,
    get() {
      if (cache === null) return { ...defaults }
      return cache
    },
  }
}
