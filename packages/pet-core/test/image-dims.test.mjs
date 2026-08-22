import assert from 'node:assert/strict'
import test from 'node:test'

import { imageDims, spriteMime } from '../dist/index.js'

function pngBytes(width, height) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes[16] = (width >>> 24) & 0xff
  bytes[17] = (width >>> 16) & 0xff
  bytes[18] = (width >>> 8) & 0xff
  bytes[19] = width & 0xff
  bytes[20] = (height >>> 24) & 0xff
  bytes[21] = (height >>> 16) & 0xff
  bytes[22] = (height >>> 8) & 0xff
  bytes[23] = height & 0xff
  return bytes
}

test('PNG dimensions', () => {
  assert.deepEqual(imageDims(pngBytes(1536, 1872)), { width: 1536, height: 1872 })
})

test('WebP VP8X dimensions', () => {
  const bytes = new Uint8Array(30)
  bytes.set([0x52, 0x49, 0x46, 0x46])
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)
  const w = 1536 - 1
  const h = 2288 - 1
  bytes[24] = w & 0xff
  bytes[25] = (w >>> 8) & 0xff
  bytes[26] = (w >>> 16) & 0xff
  bytes[27] = h & 0xff
  bytes[28] = (h >>> 8) & 0xff
  bytes[29] = (h >>> 16) & 0xff
  assert.deepEqual(imageDims(bytes), { width: 1536, height: 2288 })
})

test('WebP VP8 and VP8L dimensions', () => {
  const vp8 = new Uint8Array(30)
  vp8.set([0x52, 0x49, 0x46, 0x46])
  vp8.set([0x57, 0x45, 0x42, 0x50], 8)
  vp8.set([0x56, 0x50, 0x38, 0x20], 12)
  vp8.set([0x9d, 0x01, 0x2a], 20)
  const w = 1536 & 0x3fff
  const h = 1872 & 0x3fff
  vp8[26] = w & 0xff
  vp8[27] = (w >>> 8) & 0xff
  vp8[28] = h & 0xff
  vp8[29] = (h >>> 8) & 0xff
  assert.deepEqual(imageDims(vp8), { width: 1536, height: 1872 })

  const vp8l = new Uint8Array(30)
  vp8l.set([0x52, 0x49, 0x46, 0x46])
  vp8l.set([0x57, 0x45, 0x42, 0x50], 8)
  vp8l.set([0x56, 0x50, 0x38, 0x4c], 12)
  vp8l[20] = 0x2f
  const bits = ((1872 - 1) << 14) | (1536 - 1)
  vp8l[21] = bits & 0xff
  vp8l[22] = (bits >>> 8) & 0xff
  vp8l[23] = (bits >>> 16) & 0xff
  vp8l[24] = (bits >>> 24) & 0xff
  assert.deepEqual(imageDims(vp8l), { width: 1536, height: 1872 })
})

test('unknown bytes and mime fallback', () => {
  assert.equal(imageDims(new Uint8Array([1, 2, 3])), null)
  assert.equal(spriteMime('spritesheet.png'), 'image/png')
  assert.equal(spriteMime('spritesheet.webp'), 'image/webp')
  assert.equal(spriteMime('spritesheet.gif'), 'image/png')
})
