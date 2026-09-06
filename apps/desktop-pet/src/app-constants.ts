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

/* ---------- 主题词汇表（设置窗口外观） ---------- */

/** 主题模式：跟随系统深浅色，或固定深色 / 浅色。 */
export type ThemeMode = 'system' | 'dark' | 'light'
/** 深色侧可选主题（body[data-theme] 同名 token 集，见 style.css）。 */
export type DarkThemeId = 'graphite' | 'warm-night' | 'midnight' | 'neon'
/** 浅色侧可选主题。 */
export type LightThemeId = 'classic' | 'warm-paper' | 'clear-sky'
export type ThemeId = DarkThemeId | LightThemeId

export const THEME_MODES: readonly ThemeMode[] = ['system', 'dark', 'light']
export const DARK_THEME_IDS: readonly DarkThemeId[] = ['graphite', 'warm-night', 'midnight', 'neon']
export const LIGHT_THEME_IDS: readonly LightThemeId[] = ['classic', 'warm-paper', 'clear-sky']

/* ---------- 语言词汇表（主题显示名等文案在 i18n.ts 词典中） ---------- */

/** 语言设置：跟随系统，或固定中文 / 英文。 */
export type LanguageId = 'system' | 'zh' | 'en'

export const LANGUAGE_IDS: readonly LanguageId[] = ['system', 'zh', 'en']
