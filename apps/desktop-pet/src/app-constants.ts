/**
 * Browser-safe desktop pet constants.
 *
 * These are shared between the pet/settings webviews and are intentionally
 * free of Node-only imports so they can be bundled by Vite.
 */

export const PET_MARKET_URL = 'https://petdex.dev/zh'
export const PET_MARKET_URL_ZH = PET_MARKET_URL
export const ZOOM_MIN = 0.4
export const ZOOM_MAX = 3
export const APP_NAME = '桌宠'
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0'
