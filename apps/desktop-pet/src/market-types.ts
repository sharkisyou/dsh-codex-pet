/**
 * 在线宠物市场（petdex.dev）的共享类型。
 *
 * 纯类型，浏览器与 Node 都可安全导入；实际网络/文件逻辑在 market.ts（仅 Node）。
 */

/** 市场条目（petdex manifest 中的一只宠物）。 */
export interface MarketPet {
  slug: string
  displayName: string
  kind: string | null
  submittedBy: string | null
  spritesheetUrl: string | null
  petJsonUrl: string | null
  zipUrl: string | null
}

/** petdex manifest 顶层结构。 */
export interface MarketManifest {
  generatedAt: string
  total: number
  pets: MarketPet[]
}

/** 安装结果。 */
export type MarketInstallResult =
  | { ok: true; value: { id: string; displayName: string; sourceDir: string } }
  | { ok: false; error: string }
