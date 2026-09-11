/**
 * 图集 → 卡片缩略图（仅 Node 侧，依赖 sharp）。
 *
 * 市场卡片与本地宠物卡片共用：裁出图集首帧（左上 192×208）并缩到 96×104 的
 * webp data URL（约 9KB）。
 *
 * 为什么必须有这条路径：卡片缩略图以前直接铺**整张精灵**（1536×1872 解码后
 * ~11MB/张），5 只本地宠物就把设置窗渲染进程堆顶到 ~100MB。缩略图只有 ~9KB。
 */

import sharp from 'sharp'

/** 缩略图输出尺寸（与市场缩略图一致）。 */
export const THUMB_WIDTH = 96
export const THUMB_HEIGHT = 104
/** 图集标准单元格尺寸（首帧裁剪范围）。 */
export const ATLAS_CELL_WIDTH = 192
export const ATLAS_CELL_HEIGHT = 208
/** webp 质量（与市场缩略图一致）。 */
export const THUMB_WEBP_QUALITY = 82

/**
 * 把一张图集压成卡片缩略图的 data URL。
 *
 * 小尺寸/非标准图集自动退化为"整体裁剪"，避免 extract 越界导致整张失败
 * （与市场缩略图同一套兜底策略）。
 */
export async function spriteThumbDataUrl(sprite: Buffer | Uint8Array): Promise<string> {
  const meta = await sharp(sprite).metadata()
  const frameWidth = Math.min(ATLAS_CELL_WIDTH, meta.width ?? ATLAS_CELL_WIDTH)
  const frameHeight = Math.min(ATLAS_CELL_HEIGHT, meta.height ?? ATLAS_CELL_HEIGHT)
  const thumb = await sharp(sprite)
    .extract({ left: 0, top: 0, width: frameWidth, height: frameHeight })
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'fill' })
    .webp({ quality: THUMB_WEBP_QUALITY })
    .toBuffer()
  return `data:image/webp;base64,${thumb.toString('base64')}`
}
