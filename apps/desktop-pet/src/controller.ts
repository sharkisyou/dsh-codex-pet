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

export interface AppStateSnapshot {
  settings: PetSettings
  pets: PetLibraryEntry[]
  agents: string[]
  activity: ActivitySnapshot
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
}

export interface AppController {
  readonly server: PetServer
  readonly library: PetLibrary
  readonly store: SettingsStore
  listPets(): Promise<PetLibraryEntry[]>
  reloadLibrary(): Promise<PetLibraryEntry[]>
  loadPet(id: string): Promise<LoadedPetPackage | null>
  getSettings(): PetSettings
  updateSettings(patch: Partial<PetSettings>): Promise<{ ok: true; settings: PetSettings } | { ok: false; error: string }>
  stateSnapshot(): Promise<AppStateSnapshot>
  activitySnapshot(): ActivitySnapshot
  agents(): string[]
  subscribe(listener: () => void): () => void
  notify(): void
  dispose(): void
}

export interface StoredPetRecord {
  pet: ParsedPet
  atlasRows: number
  spriteBase64: string
  spriteMime: string
  spriteDataUrl: string
}

export function createAppController(options: AppControllerOptions): AppController {
  const {
    server,
    library,
    store,
    version = '0.1.0',
    marketUrl = PET_MARKET_URL,
  } = options

  const listeners = new Set<() => void>()
  const petCache = new Map<string, LoadedPetPackage>()
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
    if (cached !== undefined) return cached
    const result = await library.loadPet(id)
    if (!result.ok) return null
    petCache.set(id, result.value)
    return result.value
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
    return {
      settings,
      pets,
      agents: agentList(),
      activity: activitySnapshot(),
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
    getSettings,
    updateSettings,
    stateSnapshot,
    activitySnapshot,
    agents: agentList,
    subscribe,
    notify,
    dispose,
  }
}

export const zoomRange = { min: ZOOM_MIN, max: ZOOM_MAX }
