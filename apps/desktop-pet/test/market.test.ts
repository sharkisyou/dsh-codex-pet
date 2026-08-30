import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMarket, DEFAULT_MANIFEST_URL, safeSlug } from '../src/market'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

const PET_MANIFEST = {
  id: 'testpet',
  displayName: 'Test Pet',
  description: 'A test pet',
  spritesheetPath: 'spritesheet.webp',
  spriteVersionNumber: 1,
}

function fakeFetch(routes: Record<string, { body: Buffer | string; type?: string }>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split('?')[0]
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404 })
    return new Response(route.body as BodyInit, {
      status: 200,
      headers: { 'Content-Type': route.type ?? 'application/json' },
    })
  }
}

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-market-test-'))
}

test('safeSlug 只保留安全字符并拒绝路径穿越', () => {
  assert.equal(safeSlug('Homelander'), 'homelander')
  assert.equal(safeSlug('a b!c'), 'a-b-c')
  assert.equal(safeSlug('..'), '')
  // '../etc' 会被净化成安全的目录名（'/' 和 '.' 被替换），无穿越风险
  assert.equal(safeSlug('../etc'), 'etc')
  assert.equal(safeSlug(''), '')
  assert.equal(safeSlug('忍者-2'), '2') // 非 ascii 被剔除
})

test('默认 manifest URL 指向 assets.petdex.dev（petdex 已从 crafter.run 迁移）', () => {
  // 旧地址 petdex.crafter.run/api/manifest 已 308 迁移到 assets.petdex.dev；
  // 直连新域名省去重定向一跳，且与单宠物资源同源。
  assert.equal(DEFAULT_MANIFEST_URL, 'https://assets.petdex.dev/manifests/petdex-v1.json')
})

test('listPets 过滤查询并分页', async () => {
  const pets = [
    { slug: 'homelander', displayName: 'Homelander', kind: 'character', submittedBy: 'Serhat', spritesheetUrl: null, petJsonUrl: null, zipUrl: null },
    { slug: 'naruto', displayName: 'Naruto', kind: 'character', submittedBy: 'Bob', spritesheetUrl: null, petJsonUrl: null, zipUrl: null },
    { slug: 'pikachu', displayName: 'Pikachu', kind: 'pokemon', submittedBy: 'Ann', spritesheetUrl: null, petJsonUrl: null, zipUrl: null },
    { slug: 'sasuke', displayName: 'Sasuke', kind: 'character', submittedBy: 'Ann', spritesheetUrl: null, petJsonUrl: null, zipUrl: null },
    { slug: 'itachi', displayName: 'Itachi', kind: 'character', submittedBy: 'Bob', spritesheetUrl: null, petJsonUrl: null, zipUrl: null },
  ]
  const fetchImpl = fakeFetch({
    'https://petdex.test/manifest': { body: JSON.stringify({ generatedAt: 'now', total: 5, pets }) },
  })
  const market = createMarket({ manifestUrl: 'https://petdex.test/manifest', fetchImpl })

  const all = await market.listPets({ pageSize: 100 })
  assert.equal(all.pets.length, 5)
  assert.equal(all.total, 5)

  const byQuery = await market.listPets({ query: 'naruto' })
  assert.equal(byQuery.pets.length, 1)
  assert.equal(byQuery.pets[0].slug, 'naruto')
  assert.equal(byQuery.total, 1)

  const byKind = await market.listPets({ kind: 'pokemon' })
  assert.equal(byKind.pets.length, 1)
  assert.equal(byKind.pets[0].slug, 'pikachu')

  // 分页：每页 2 条
  const page1 = await market.listPets({ pageSize: 2, page: 1 })
  assert.equal(page1.pets.length, 2)
  assert.equal(page1.total, 5)
  const page2 = await market.listPets({ pageSize: 2, page: 2 })
  assert.equal(page2.pets.length, 2)
  assert.notEqual(page2.pets[0].slug, page1.pets[0].slug)
  const page3 = await market.listPets({ pageSize: 2, page: 3 })
  assert.equal(page3.pets.length, 1) // 最后一页剩 1 条
})

test('installPet 从单文件资产安装并校验', async () => {
  const root = await makeTempRoot()
  try {
    const fetchImpl = fakeFetch({
      'https://petdex.test/pet.json': { body: JSON.stringify(PET_MANIFEST) },
      'https://petdex.test/sprite.webp': { body: Buffer.from('fake-webp-bytes'), type: 'image/webp' },
    })
    const market = createMarket({ fetchImpl, installRoot: root })

    const result = await market.installPet({
      slug: 'testpet',
      displayName: 'Test Pet',
      kind: 'character',
      submittedBy: null,
      spritesheetUrl: 'https://petdex.test/sprite.webp',
      petJsonUrl: 'https://petdex.test/pet.json',
      zipUrl: null,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.id, 'testpet')
    assert.ok(result.value.sourceDir.endsWith('testpet'))

    const files = await readdir(join(root, 'testpet'))
    assert.ok(files.includes('pet.json'))
    assert.ok(files.includes('spritesheet.webp'))
    const manifest = JSON.parse(await readFile(join(root, 'testpet', 'pet.json'), 'utf8'))
    assert.equal(manifest.spritesheetPath, 'spritesheet.webp')
    const spriteStat = await stat(join(root, 'testpet', 'spritesheet.webp'))
    assert.ok(spriteStat.size > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('installPet 从 zip 安装', async () => {
  const root = await makeTempRoot()
  try {
    const zip = new AdmZip()
    zip.addFile('pet.json', Buffer.from(JSON.stringify(PET_MANIFEST)))
    zip.addFile('spritesheet.webp', Buffer.from('zip-webp-bytes'))
    const zipBuffer = zip.toBuffer()

    const fetchImpl = fakeFetch({
      'https://petdex.test/package.zip': { body: zipBuffer, type: 'application/zip' },
    })
    const market = createMarket({ fetchImpl, installRoot: root })

    const result = await market.installPet({
      slug: 'zippet',
      displayName: 'Zip Pet',
      kind: null,
      submittedBy: null,
      spritesheetUrl: null,
      petJsonUrl: null,
      zipUrl: 'https://petdex.test/package.zip',
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.id, 'testpet')
    const files = await readdir(join(root, 'zippet'))
    assert.ok(files.includes('pet.json'))
    assert.ok(files.includes('spritesheet.webp'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uninstallPet 删除宠物目录', async () => {
  const root = await makeTempRoot()
  try {
    const fetchImpl = fakeFetch({
      'https://petdex.test/pet.json': { body: JSON.stringify(PET_MANIFEST) },
      'https://petdex.test/sprite.webp': { body: Buffer.from('fake-webp-bytes'), type: 'image/webp' },
    })
    const market = createMarket({ fetchImpl, installRoot: root })
    const installed = await market.installPet({
      slug: 'testpet',
      displayName: 'Test Pet',
      kind: null,
      submittedBy: null,
      spritesheetUrl: 'https://petdex.test/sprite.webp',
      petJsonUrl: 'https://petdex.test/pet.json',
      zipUrl: null,
    })
    assert.equal(installed.ok, true)
    assert.equal(await readdir(root).then((d) => d.includes('testpet')), true)

    const result = await market.uninstallPet('testpet')
    assert.equal(result.ok, true)
    assert.equal(await readdir(root).then((d) => d.includes('testpet')), false)

    // 非法 slug（净化后为空）拒绝；'../etc' 会被安全净化成 'etc'，无穿越风险
    const bad = await market.uninstallPet('..')
    assert.equal(bad.ok, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('installPet 校验失败时回滚，不留临时目录', async () => {
  const root = await makeTempRoot()
  try {
    const fetchImpl = fakeFetch({
      'https://petdex.test/pet.json': { body: JSON.stringify({ id: 'bad' }) }, // 缺字段，parsePetJson 失败
      'https://petdex.test/sprite.webp': { body: Buffer.from('x'), type: 'image/webp' },
    })
    const market = createMarket({ fetchImpl, installRoot: root })
    const result = await market.installPet({
      slug: 'badpet',
      displayName: 'Bad',
      kind: null,
      submittedBy: null,
      spritesheetUrl: 'https://petdex.test/sprite.webp',
      petJsonUrl: 'https://petdex.test/pet.json',
      zipUrl: null,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.error.length > 0)
    const dirs = await readdir(root)
    assert.equal(dirs.length, 0) // 没有残留
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
