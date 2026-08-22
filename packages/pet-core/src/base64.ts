/**
 * Bytes -> base64 (the dynamic plugin host's btoa follows UTF-8 text semantics
 * and cannot be used for binary data).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: ArrayLike<number>): string {
  let out = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < len ? bytes[i + 1] : 0
    const b2 = i + 2 < len ? bytes[i + 2] : 0
    out += ALPHABET[b0 >> 2]
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += i + 1 < len ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
    out += i + 2 < len ? ALPHABET[b2 & 0x3f] : '='
  }
  return out
}
