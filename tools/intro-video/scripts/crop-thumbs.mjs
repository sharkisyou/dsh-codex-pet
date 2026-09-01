// 从已安装宠物包里裁剪首帧（idle 第 0 帧）缩略图，供市场场景网格使用。
// 用法：node scripts/crop-thumbs.mjs
import { createRequire } from 'node:module'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const sharp = require('/home/weikang/dsh-pet-plugin/node_modules/sharp')

const PETS_DIR = join(homedir(), '.codex', 'pets')
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'thumbs')

// 市场场景展示的宠物（slug 目录名 → 展示名）
const PETS = [
  ['batmeme', 'Batmeme'],
  ['dimo-4', 'Dimo'],
  ['lulu-capybara-2', 'Lulu'],
  ['the-herta', 'The Herta'],
  ['rx-78-2-gundam', 'RX-78-2'],
  ['shana-pet', 'Shana'],
  ['vivian', 'Vivian'],
  ['chibi-gundam', 'Chibi Gundam'],
  ['xiao-remu', 'Xiao Remu'],
  ['koko-2', 'Koko'],
]

const CELL_W = 192
const CELL_H = 208

mkdirSync(OUT_DIR, { recursive: true })

let ok = 0
for (const [slug, name] of PETS) {
  const dir = join(PETS_DIR, slug)
  const files = readdirSync(dir)
  const sprite = files.find((f) => f.startsWith('spritesheet.'))
  if (!sprite) {
    console.error(`SKIP ${slug}: no spritesheet`)
    continue
  }
  try {
    const out = join(OUT_DIR, `${slug}.png`)
    await sharp(join(dir, sprite))
      .extract({ left: 0, top: 0, width: CELL_W, height: CELL_H })
      .png()
      .toFile(out)
    console.log(`OK ${slug} (${name}) -> ${out}`)
    ok++
  } catch (e) {
    console.error(`FAIL ${slug}: ${e.message}`)
  }
}

console.log(`done: ${ok}/${PETS.length}`)
