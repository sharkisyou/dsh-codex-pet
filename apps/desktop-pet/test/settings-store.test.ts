import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_SETTINGS,
  ZOOM_MAX,
  ZOOM_MIN,
  createSettingsStore,
  resolveAppDataDir,
  sanitizeSettings,
} from '../src/settings-store'

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'desktop-pet-settings-'))
}

test('returns defaults when settings file is missing', async () => {
  const dir = await makeTempDir()
  try {
    const store = createSettingsStore({ dataDir: dir })
    const loaded = await store.load()
    assert.deepEqual(loaded, DEFAULT_SETTINGS)
    assert.equal(store.get().selectedPetId, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('persists and reloads selection/zoom/wake', async () => {
  const dir = await makeTempDir()
  try {
    const store = createSettingsStore({ dataDir: dir })
    settings: {
      const updated = await store.update({ selectedPetId: 'cat', zoom: 1.8, awake: false })
      assert.equal(updated.selectedPetId, 'cat')
      assert.equal(updated.zoom, 1.8)
      assert.equal(updated.awake, false)
    }

    const reloaded = createSettingsStore({ dataDir: dir })
    const loaded = await reloaded.load()
    assert.equal(loaded.selectedPetId, 'cat')
    assert.equal(loaded.zoom, 1.8)
    assert.equal(loaded.awake, false)

    const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    assert.equal(raw.selectedPetId, 'cat')
    assert.equal(raw.awake, false)

    // The temp file should be gone after an atomic-ish save.
    await assert.rejects(access(join(dir, 'settings.json.tmp')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sanitizes invalid persisted values', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS)
  const sanitized = sanitizeSettings({
    selectedPetId: 42,
    zoom: 99,
    awake: 'yes',
    themeMode: 'auto',
    darkTheme: 'solarized',
    lightTheme: 7,
    language: 'fr',
    unknown: true,
  })
  assert.equal(sanitized.selectedPetId, null)
  assert.equal(sanitized.zoom, ZOOM_MAX)
  assert.equal(sanitized.themeMode, DEFAULT_SETTINGS.themeMode)
  assert.equal(sanitized.darkTheme, DEFAULT_SETTINGS.darkTheme)
  assert.equal(sanitized.lightTheme, DEFAULT_SETTINGS.lightTheme)
  assert.equal(sanitized.language, DEFAULT_SETTINGS.language)
  const tiny = sanitizeSettings({ zoom: -3 })
  assert.equal(tiny.zoom, ZOOM_MIN)
  const nonNumber = sanitizeSettings({ zoom: '2.5' })
  assert.equal(nonNumber.zoom, DEFAULT_SETTINGS.zoom)
})

test('sanitizes theme fields and persists valid ones', async () => {
  assert.equal(sanitizeSettings({ themeMode: 'dark' }).themeMode, 'dark')
  assert.equal(sanitizeSettings({ darkTheme: 'neon' }).darkTheme, 'neon')
  assert.equal(sanitizeSettings({ lightTheme: 'clear-sky' }).lightTheme, 'clear-sky')
  assert.equal(sanitizeSettings({ language: 'en' }).language, 'en')

  const dir = await makeTempDir()
  try {
    const store = createSettingsStore({ dataDir: dir })
    const updated = await store.update({ themeMode: 'dark', darkTheme: 'midnight', lightTheme: 'warm-paper', language: 'en' })
    assert.equal(updated.themeMode, 'dark')
    assert.equal(updated.darkTheme, 'midnight')
    assert.equal(updated.lightTheme, 'warm-paper')
    assert.equal(updated.language, 'en')

    const reloaded = createSettingsStore({ dataDir: dir })
    const loaded = await reloaded.load()
    assert.equal(loaded.themeMode, 'dark')
    assert.equal(loaded.darkTheme, 'midnight')
    assert.equal(loaded.lightTheme, 'warm-paper')
    assert.equal(loaded.language, 'en')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('persists pet-window position', async () => {
  const dir = await makeTempDir()
  try {
    const store = createSettingsStore({ dataDir: dir })
    const updated = await store.update({ windowX: 1234, windowY: 567 })
    assert.equal(updated.windowX, 1234)
    assert.equal(updated.windowY, 567)

    const reloaded = createSettingsStore({ dataDir: dir })
    const loaded = await reloaded.load()
    assert.equal(loaded.windowX, 1234)
    assert.equal(loaded.windowY, 567)

    const raw = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    assert.equal(raw.windowX, 1234)
    assert.equal(raw.windowY, 567)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sanitizes invalid persisted positions to null', () => {
  const sanitized = sanitizeSettings({ windowX: 'left', windowY: Number.NaN })
  assert.equal(sanitized.windowX, null)
  assert.equal(sanitized.windowY, null)
})

test('resolveAppDataDir uses platform conventions and env override', () => {
  const originalDir = process.env.DSH_PET_DATA_DIR
  const originalXdg = process.env.XDG_DATA_HOME
  const originalAppData = process.env.APPDATA
  const originalHome = process.env.HOME
  try {
    assert.equal(
      resolveAppDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/xdg' }, home: '/home/u' }),
      '/xdg/dev.yshark.desktop-pet',
    )
    assert.equal(
      resolveAppDataDir({ platform: 'linux', env: {}, home: '/home/u' }),
      '/home/u/.local/share/dev.yshark.desktop-pet',
    )
    assert.equal(
      resolveAppDataDir({ platform: 'darwin', env: {}, home: '/Users/u' }),
      '/Users/u/Library/Application Support/dev.yshark.desktop-pet',
    )
    assert.equal(
      resolveAppDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u' }),
      'C:\\Users\\u\\AppData\\Roaming/dev.yshark.desktop-pet',
    )

    process.env.DSH_PET_DATA_DIR = '/tmp/custom-pet-data'
    assert.equal(resolveAppDataDir({ platform: 'linux', env: {}, home: '/home/u' }), '/tmp/custom-pet-data')
  } finally {
    if (originalDir === undefined) delete process.env.DSH_PET_DATA_DIR
    else process.env.DSH_PET_DATA_DIR = originalDir
    if (originalXdg === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalXdg
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  }
})
