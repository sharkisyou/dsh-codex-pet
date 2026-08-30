/**
 * Bytes -> base64 (the dynamic plugin host's btoa follows UTF-8 text semantics
 * and cannot be used for binary data).
 *
 * Implementation note: this runs on multi-megabyte spritesheets. Naive `out +=
 * char` concatenation builds a huge V8 rope tree (one cons-string node per
 * append), which multiplied heap usage ~20x per sprite and OOM'd the desktop
 * pet server after loading a handful of pets. We therefore build output in
 * bounded chunks and join once, keeping peak memory ~2x the output size.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Input bytes processed per chunk. Must be a multiple of 3 so a 3-byte group
 * never straddles a chunk boundary (padding/encoding stays exact).
 */
const CHUNK_BYTES = 32766

export function bytesToBase64(bytes: ArrayLike<number>): string {
  const len = bytes.length
  if (len === 0) return ''
  const parts: string[] = []
  for (let start = 0; start < len; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, len)
    let out = ''
    for (let i = start; i < end; i += 3) {
      const b0 = bytes[i]
      const b1 = i + 1 < len ? bytes[i + 1] : 0
      const b2 = i + 2 < len ? bytes[i + 2] : 0
      out += ALPHABET[b0 >> 2]
      out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
      out += i + 1 < len ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
      out += i + 2 < len ? ALPHABET[b2 & 0x3f] : '='
    }
    parts.push(out)
  }
  return parts.join('')
}
