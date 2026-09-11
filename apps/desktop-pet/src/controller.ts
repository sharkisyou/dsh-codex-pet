/**
 * Desktop pet application controller.
 *
 * This is the glue between the WebSocket bridge server, the read-only Codex
 * pet library, and the persistent settings store. It exposes a small read/update
 * model used by the settings and pet windows through the internal UI control
 * channel.
 */

import type { ParsedPet, SessionStoreActivity } from '@yshark/pet-core'

import type { PetServer } from './server.js'
import type { PetLibrary, PetLibraryEntry, LoadedPetPackage } from './pet-library.js'
import { spriteThumbDataUrl } from './pet-thumbnail.js'
import type { PetSettings, SettingsStore } from './settings-store.js'
import { ZOOM_MAX, ZOOM_MIN, sanitizeSettings } from './settings-store.js'

export const PET_MARKET_URL = 'https://petdex.dev/zh'

export interface ActivitySnapshot {
  displayState: string
  state: string
  bubbleKey: string | null
  bubbleParams: Record<string, unknown> | null
  agent: string | null
  sessionId: string | null
}

export interface TrayItemSnapshot {
  key: string
  agent: string | null
  sessionId: string
  state: string
  activityState: string
  displayState: string
  bubbleKey: string | null
  bubbleParams: Record<string, unknown> | null
  pendingKind: string | null
  lastEventAt: number
  acknowledged: boolean
  active: boolean
  reminder: boolean
  title: string
}

export interface AppStateSnapshot {
  settings: PetSettings
  pets: PetLibraryEntry[]
  agents: string[]
  activity: ActivitySnapshot
  activities?: TrayItemSnapshot[]
  tray?: TrayItemSnapshot[]
  allActivities?: TrayItemSnapshot[]
  libraryRoot: string
  marketUrl: string
  version: string
}

export interface AppControllerOptions {
  server: PetServer
  library: PetLibrary
  store: SettingsStore
  version?: string
  marketUrl?: string
  /** 本地宠物加载缓存 LRU 上限（每个条目含完整 sprite data URL）。默认 60。 */
  petCacheMax?: number
}

export interface AppController {
  readonly server: PetServer
  readonly library: PetLibrary
  readonly store: SettingsStore
  listPets(): Promise<PetLibraryEntry[]>
  reloadLibrary(): Promise<PetLibraryEntry[]>
  loadPet(id: string): Promise<LoadedPetPackage | null>
  /** 本地宠物卡片缩略图（96×104 webp data URL）。 */
  petThumbnail(id: string): Promise<string | null>
  getSettings(): PetSettings
  updateSettings(patch: Partial<PetSettings>): Promise<{ ok: true; settings: PetSettings } | { ok: false; error: string }>
  stateSnapshot(): Promise<AppStateSnapshot>
  activitySnapshot(): ActivitySnapshot
  activityList(): TrayItemSnapshot[]
  trayActivities(): TrayItemSnapshot[]
  activities(): TrayItemSnapshot[]
  tray(): TrayItemSnapshot[]
  allActivities(): TrayItemSnapshot[]
  markActivityRead(agent: string, sessionId: string): boolean
  markRead(agent: string, sessionId: string): boolean
  openSession(agent: string, sessionId: string, reason?: string): boolean
  handleTrayClick(agent: string, sessionId: string, reason?: string): { read: boolean; opened: boolean }
  trayOpen(agent: string, sessionId: string, reason?: string): { read: boolean; opened: boolean }
  agents(): string[]
  subscribe(listener: () => void): () => void
  notify(): void
  dispose(): void
}

export interface StoredPetRecord {
  pet: ParsedPet
  atlasRows: number
  /** 整张 sprite 的 data URL（含 mime 与 base64）。 */
  spriteDataUrl: string
}

export function createAppController(options: AppControllerOptions): AppController {
  const {
    server,
    library,
    store,
    version = '0.1.0',
    marketUrl = PET_MARKET_URL,
    petCacheMax = 60,
  } = options

  const listeners = new Set<() => void>()
  // 本地宠物加载缓存：每个条目含完整 sprite data URL（~2-4MB）。无界缓存
  // 曾导致设置窗一次性请求全部本地宠物后服务端 JS heap OOM；加 LRU 上限。
  // 单机宠物库通常 <60 只，上限取 60 足够覆盖正常使用。
  const PET_CACHE_MAX = Math.max(1, petCacheMax)
  const petCache = new Map<string, LoadedPetPackage>()
  // 本地宠物缩略图缓存（~9KB/条）：卡片只请求小图，和整张精灵的 petCache 分开。
  const THUMB_CACHE_MAX = 256
  const thumbCache = new Map<string, string>()
  let petListCache: PetLibraryEntry[] | null = null
  let disposed = false

  function notify(): void {
    if (disposed) return
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // listener errors must not break the controller
      }
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function agentList(): string[] {
    return server.connectedAgents()
  }

  function activitySnapshot(): ActivitySnapshot {
    const activity = server.currentActivity() as (SessionStoreActivity & { activityState?: string }) | null
    return {
      displayState: server.currentDisplayState(),
      state: activity?.state ?? 'idle',
      bubbleKey: activity?.bubbleKey ?? null,
      bubbleParams: activity?.bubbleParams ?? null,
      agent: activity?.agent ?? null,
      sessionId: activity?.sessionId ?? null,
    }
  }

  function toTrayItem(activity: SessionStoreActivity): TrayItemSnapshot {
    return {
      key: activity.key,
      agent: activity.agent,
      sessionId: activity.sessionId,
      state: activity.state,
      activityState: activity.activityState,
      displayState: activity.activityState,
      bubbleKey: activity.bubbleKey,
      bubbleParams: activity.bubbleParams,
      pendingKind: activity.pendingKind,
      lastEventAt: activity.lastEventAt,
      acknowledged: activity.acknowledged,
      active: activity.active,
      reminder: activity.reminder,
      title: activity.title ?? activity.sessionId,
    }
  }

  function activityList(): TrayItemSnapshot[] {
    return server.activeActivities().map(toTrayItem)
  }

  function trayActivities(): TrayItemSnapshot[] {
    return server.activeActivities()
      .filter((activity) => activity.reminder)
      .map(toTrayItem)
  }

  function allActivities(): TrayItemSnapshot[] {
    return server.activeActivities().map(toTrayItem)
  }

  function markActivityRead(agent: string, sessionId: string): boolean {
    if (typeof agent !== 'string' || agent === '' || typeof sessionId !== 'string' || sessionId === '') return false
    server.store.markAcknowledged(agent, sessionId)
    notify()
    return true
  }

  function openSession(agent: string, sessionId: string, reason = 'tray'): boolean {
    return server.openSession(agent, sessionId, reason)
  }

  function handleTrayClick(agent: string, sessionId: string, reason = 'tray'): { read: boolean; opened: boolean } {
    const read = markActivityRead(agent, sessionId)
    const opened = openSession(agent, sessionId, reason)
    return { read, opened }
  }

  function markRead(agent: string, sessionId: string): boolean {
    return markActivityRead(agent, sessionId)
  }

  function trayOpen(agent: string, sessionId: string, reason = 'tray'): { read: boolean; opened: boolean } {
    return handleTrayClick(agent, sessionId, reason)
  }

  async function listPets(): Promise<PetLibraryEntry[]> {
    if (petListCache !== null) return petListCache
    const result = await library.listPets()
    if (result.ok) {
      petListCache = result.value
      return result.value
    }
    return []
  }

  async function reloadLibrary(): Promise<PetLibraryEntry[]> {
    petCache.clear()
    const result = await library.listPets()
    petListCache = result.ok ? result.value : []
    return petListCache
  }

  async function loadPet(id: string): Promise<LoadedPetPackage | null> {
    const cached = petCache.get(id)
    if (cached !== undefined) {
      // 刷新 LRU 顺序：命中即移到队尾。
      petCache.delete(id)
      petCache.set(id, cached)
      return cached
    }
    const result = await library.loadPet(id)
    if (!result.ok) return null
    petCache.set(id, result.value)
    // LRU 淘汰最久未用的条目，防止缓存无界增长。
    while (petCache.size > PET_CACHE_MAX) {
      const oldest = petCache.keys().next().value
      if (oldest === undefined) break
      petCache.delete(oldest)
    }
    return result.value
  }

  /**
   * 本地宠物卡片缩略图（96×104 webp data URL，~9KB）。
   *
   * 卡片以前直接用**整张精灵**当缩略图（解码后 ~11MB/张），5 只本地宠物就把
   * 设置窗渲染进程堆顶到 ~100MB。这里走 `library.loadSpriteBuffer`（不转
   * base64、不进整张精灵 LRU）+ 小 LRU 缓存，服务端与渲染进程都只留小图。
   */
  async function petThumbnail(id: string): Promise<string | null> {
    const cached = thumbCache.get(id)
    if (cached !== undefined) {
      thumbCache.delete(id)
      thumbCache.set(id, cached)
      return cached
    }
    const result = await library.loadSpriteBuffer(id)
    if (!result.ok) return null
    try {
      const dataUrl = await spriteThumbDataUrl(result.value.bytes)
      thumbCache.set(id, dataUrl)
      while (thumbCache.size > THUMB_CACHE_MAX) {
        const oldest = thumbCache.keys().next().value
        if (oldest === undefined) break
        thumbCache.delete(oldest)
      }
      return dataUrl
    } catch {
      // 图集损坏/格式不支持时静默留空，卡片显示占位样式。
      return null
    }
  }

  function getSettings(): PetSettings {
    return store.get()
  }

  async function updateSettings(patch: Partial<PetSettings>): Promise<{ ok: true; settings: PetSettings } | { ok: false; error: string }> {
    const current = await store.load()
    const next = sanitizeSettings({ ...current, ...patch })
    if (patch.selectedPetId !== undefined && next.selectedPetId !== null) {
      const pets = await listPets()
      if (!pets.some((pet) => pet.id === next.selectedPetId)) {
        return { ok: false, error: `宠物不存在: ${next.selectedPetId}` }
      }
    }
    const saved = await store.update(next)
    notify()
    return { ok: true, settings: saved }
  }

  async function stateSnapshot(): Promise<AppStateSnapshot> {
    const [settings, pets] = await Promise.all([
      store.load(),
      listPets(),
    ])
    const activities = activityList()
    return {
      settings,
      pets,
      agents: agentList(),
      activity: activitySnapshot(),
      activities,
      tray: trayActivities(),
      allActivities: allActivities(),
      libraryRoot: library.root,
      marketUrl,
      version,
    }
  }

  // Keep the controller subscribed to server changes so UI clients can receive
  // live activity/agent updates via the gateway.
  const unsubscribeServer = server.onChange(() => {
    notify()
  })

  function dispose(): void {
    if (disposed) return
    disposed = true
    unsubscribeServer()
    listeners.clear()
  }

  return {
    server,
    library,
    store,
    listPets,
    reloadLibrary,
    loadPet,
    petThumbnail,
    getSettings,
    updateSettings,
    stateSnapshot,
    activitySnapshot,
    activityList,
    trayActivities,
    activities: activityList,
    tray: trayActivities,
    allActivities,
    markActivityRead,
    markRead,
    openSession,
    handleTrayClick,
    trayOpen,
    agents: agentList,
    subscribe,
    notify,
    dispose,
  }
}

export const zoomRange = { min: ZOOM_MIN, max: ZOOM_MAX }
