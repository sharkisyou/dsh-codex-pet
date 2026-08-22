/**
 * Atlas image dimension parsing and mime selection.
 *
 * Supports PNG and WebP (VP8X / VP8 / VP8L).
 */

export interface ImageDimensions {
  width: number
  height: number
}

export function imageDims(bytes: ArrayLike<number> | null | undefined): ImageDimensions | null {
  if (bytes === null || bytes === undefined || typeof bytes !== 'object' || bytes.length < 24) return null
  // PNG
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
    return { width, height }
  }
  // WebP: RIFF....WEBP + chunk fourcc
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (fourcc === 'VP8X' && bytes.length >= 30) {
      const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1
      const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1
      return { width, height }
    }
    if (fourcc === 'VP8 ' && bytes.length >= 30 &&
        bytes[20] === 0x9d && bytes[21] === 0x01 && bytes[22] === 0x2a) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
      return { width, height }
    }
    if (fourcc === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >>> 14) & 0x3fff) + 1
      return { width, height }
    }
  }
  return null
}

export function spriteMime(name: string): string {
  const lower = String(name).toLowerCase()
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}
