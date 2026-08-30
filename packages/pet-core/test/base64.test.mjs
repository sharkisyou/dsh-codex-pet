import assert from 'node:assert/strict'
import test from 'node:test'

import { bytesToBase64 } from '../dist/index.js'

// Reference implementation (Node Buffer) for comparison.
function refBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

test('bytesToBase64 matches Buffer for empty input', () => {
  assert.equal(bytesToBase64(new Uint8Array(0)), '')
  assert.equal(bytesToBase64(new Uint8Array(0)), refBase64(new Uint8Array(0)))
})

test('bytesToBase64 matches Buffer across chunk boundaries', () => {
  // CHUNK_BYTES is 32766 (a multiple of 3). Exercise sizes around it and the
  // 2-chunk transition, plus every padding remainder (len % 3 == 0/1/2).
  const sizes = [
    1, 2, 3, 4, 7,
    32763, 32764, 32765, 32766, 32767, 32768, 32769,
    65530, 65531, 65532, 65533, 65534, 65535,
    65536, 100000, 3 * 1024 * 1024,
  ]
  for (const size of sizes) {
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff
    assert.equal(bytesToBase64(bytes), refBase64(bytes), `size ${size}`)
  }
})

test('bytesToBase64 matches Buffer for random multi-megabyte data', () => {
  const size = 5 * 1024 * 1024
  const bytes = new Uint8Array(size)
  // Deterministic pseudo-random fill (no crypto dependency in pure core tests).
  let seed = 0x12345678
  for (let i = 0; i < size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    bytes[i] = seed & 0xff
  }
  assert.equal(bytesToBase64(bytes), refBase64(bytes))
})

test('bytesToBase64 output length and padding are exact', () => {
  for (const size of [0, 1, 2, 3, 4, 32766, 32767, 32768]) {
    const bytes = new Uint8Array(size)
    const out = bytesToBase64(bytes)
    assert.equal(out.length, Math.ceil(size / 3) * 4)
    const padding = (3 - (size % 3)) % 3
    const tail = out.slice(out.length - (padding || 4))
    for (let i = 0; i < padding; i++) assert.equal(tail[i], '=')
  }
})
