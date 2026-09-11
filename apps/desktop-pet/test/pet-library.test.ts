import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CELL_H,
  CELL_W,
  createPetLibrary,
  resolveLibraryRoot,
  DEFAULT_MAX_SPRITE_BYTES,
} from '../src/pet-library'

function pngBytes(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33)
  buf.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  // IHDR chunk marker (only imageDims reads these bytes).
  buf[12] = 73 // I
  buf[13] = 72 // H
  buf[14] = 68 // D
  buf[15] = 82 // R
  buf[16] = (width >>> 24) & 0xff
  buf[17] = (width >>> 16) & 0xff
  buf[18] = (width >>> 8) & 0xff
  buf[19] = width & 0xff
  buf[20] = (height >>> 24) & 0xff
  buf[21] = (height >>> 16) & 0xff
  buf[22] = (height >>> 8) & 0xff
  buf[23] = height & 0xff
  return buf
}

async function makePetDir(root: string, id: string, opts: { rows?: number; includeImage?: boolean; includeJson?: boolean } = {}): Promise<void> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  if (opts.includeJson !== false) {
    await writeFile(join(dir, 'pet.json'), JSON.stringify({
      id,
      displayName: `Pet ${id}`,
      description: `Desc ${id}`,
      spritesheetPath: 'spritesheet.png',
      spriteVersionNumber: 1,
    }))
  }
  if (opts.includeImage !== false) {
    await writeFile(join(dir, 'spritesheet.png'), pngBytes(CELL_W * 8, CELL_H * (opts.rows ?? 1)))
  }
}

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'desktop-pet-library-'))
}

test('lists valid Codex pet packages and skips invalid directories', async () => {
  const root = await makeTempRoot()
  try {
    await makePetDir(root, 'bravo')
    await makePetDir(root, 'alpha')
    await makePetDir(root, 'broken-json', { includeJson: true, includeImage: false })
    await makePetDir(root, 'missing-json', { includeJson: false, includeImage: true })
    await makePetDir(root, 'not-a-dir', { includeJson: false, includeImage: false })

    const library = createPetLibrary({ root })
    const result = await library.listPets()
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.value.map((p) => p.id), ['alpha', 'bravo'])
      assert.equal(result.value[0].displayName, 'Pet alpha')
      assert.equal(result.value[0].description, 'Desc alpha')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loads a pet with parsed metadata and data URL sprite', async () => {
  const root = await makeTempRoot()
  try {
    await makePetDir(root, 'panda', { rows: 2 })
    const library = createPetLibrary({ root })
    const result = await library.loadPet('panda')
    assert.equal(result.ok, true)
    if (result.ok) {
      const loaded = result.value
      assert.equal(loaded.id, 'panda')
      assert.equal(loaded.pet.displayName, 'Pet panda')
      assert.equal(loaded.atlasRows, 2)
      assert.ok(loaded.spriteDataUrl.startsWith('data:image/png;base64,'))
      // data URL 已包含 mime 与完整 base64（spriteBase64/spriteMime 字段已移除）
      assert.ok(loaded.spriteDataUrl.length > 0)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects path-traversing spritesheet paths', async () => {
  const root = await makeTempRoot()
  try {
    const dir = join(root, 'evil')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'pet.json'), JSON.stringify({
      id: 'evil',
      displayName: 'Evil',
      description: '',
      spritesheetPath: '../../outside.png',
      spriteVersionNumber: 1,
    }))
    await writeFile(join(dir, 'spritesheet.png'), pngBytes(CELL_W * 8, CELL_H))
    const library = createPetLibrary({ root })
    const result = await library.loadPet('evil')
    assert.equal(result.ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects dangerous pet ids', async () => {
  const root = await makeTempRoot()
  try {
    const library = createPetLibrary({ root })
    for (const id of ['../evil', 'a/b', '.hidden', '..']) {
      const result = await library.loadPet(id)
      assert.equal(result.ok, false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects missing sprite and oversized sprites', async () => {
  const root = await makeTempRoot()
  try {
    await makePetDir(root, 'nosprite', { includeImage: false })
    const library = createPetLibrary({ root, maxSpriteBytes: 8 })
    const missing = await library.loadPet('nosprite')
    assert.equal(missing.ok, false)

    await makePetDir(root, 'big')
    const oversized = await library.loadPet('big')
    assert.equal(oversized.ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveLibraryRoot prefers explicit root then env then home subpath', () => {
  const original = process.env.DSH_PET_LIBRARY_DIR
  try {
    assert.equal(resolveLibraryRoot({ root: '/tmp/explicit' }), '/tmp/explicit')
    process.env.DSH_PET_LIBRARY_DIR = '/tmp/from-env'
    assert.equal(resolveLibraryRoot(), '/tmp/from-env')
    delete process.env.DSH_PET_LIBRARY_DIR
    assert.equal(resolveLibraryRoot({ home: '/home/tester' }), '/home/tester/.codex/pets')
  } finally {
    if (original === undefined) delete process.env.DSH_PET_LIBRARY_DIR
    else process.env.DSH_PET_LIBRARY_DIR = original
  }
})

test('exposes a large default sprite limit', () => {
  assert.ok(DEFAULT_MAX_SPRITE_BYTES >= 25 * 1024 * 1024)
})

test('loadSpriteBuffer 只读图集原始字节（缩略图路径，不转 base64）', async () => {
  const root = await makeTempRoot()
  try {
    await makePetDir(root, 'alpha')
    const library = createPetLibrary({ root })

    const buffer = await library.loadSpriteBuffer('alpha')
    assert.ok(buffer.ok, '应能读到图集')
    if (buffer.ok) {
      assert.equal(buffer.value.width, CELL_W * 8)
      assert.equal(buffer.value.height, CELL_H)
      assert.equal(buffer.value.mime, 'image/png')
      assert.equal(buffer.value.atlasRows, 1)
      assert.ok(buffer.value.bytes.byteLength > 0)
      assert.ok(!('spriteDataUrl' in (buffer.value as unknown as Record<string, unknown>)), '不应带 base64 data URL')
    }

    // 非法 id / 不存在的宠物：与 loadPet 同一套错误映射。
    const illegal = await library.loadSpriteBuffer('../evil')
    assert.equal(illegal.ok, false)
    const missing = await library.loadSpriteBuffer('nope')
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.error, '宠物不存在')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
