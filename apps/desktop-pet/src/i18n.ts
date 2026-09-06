/**
 * Browser-safe i18n for the desktop-pet UI windows.
 *
 * - 词汇表（LanguageId）在 app-constants.ts，与主题词汇放在一起；
 * - 本模块只负责「解析当前语言」与「取词」：t(key, params)。
 * - 语言切换是低频事件：设置窗口用 data-i18n 标记静态文案，切换时统一
 *   重写；动态文案（状态行、列表等）由各 render 函数在语言切换后重跑。
 */

import type { LanguageId } from './app-constants.js'

export type LanguageCode = 'zh' | 'en'

type Dict = Record<string, string>

const ZH: Dict = {
  'app.name': '桌宠',
  'title.settings': '桌宠设置',
  'title.pet': '桌宠',
  'title.tray': '活动',

  'nav.settings': '设置',
  'nav.pets': '宠物',
  'nav.market': '市场',

  'page.settings.title': '设置',
  'page.pets.title': '宠物',
  'page.market.title': '市场',
  'page.settings.subtitle': '管理桌宠、缩放、唤醒与宠物库。',
  'page.pets.subtitle': '管理本地宠物。',
  'page.market.subtitle': '从 petdex.dev 发现并安装更多宠物。',

  'status.connecting': '连接中…',
  'status.offline': '离线',
  'status.online': '已连接',
  'status.noTools': '未连接来自工具',
  'status.connectedTo': '已连接：{agents}',

  'error.offline': '无法连接桌宠服务，设置窗处于离线显示',

  'group.pet': '桌宠',
  'group.appearance': '外观',
  'group.system': '系统',

  'card.pet': '当前宠物',
  'card.zoom': '缩放',
  'card.wake': '唤醒',
  'card.theme': '主题',
  'card.language': '语言',
  'card.storage': '存储',
  'card.system': '系统信息',

  'pet.hint1': '当前桌宠会跟随任务状态在桌面活动。',
  'pet.hint2': '选择或浏览宠物库，请到「宠物」页面。',
  'pet.choose': '去宠物页选择',
  'pet.unselected': '未选择',
  'zoom.hint': '按住 Ctrl 并在桌宠窗口滚动鼠标滚轮，也可以调整大小。',
  'wake.label': '跟随会话自动显示 / 隐藏',
  'wake.hint': '关闭时宠物保持隐藏，不随任务状态出现。',

  'theme.mode': '模式',
  'theme.mode.system': '系统',
  'theme.mode.dark': '深色',
  'theme.mode.light': '浅色',
  'theme.dark': '深色主题',
  'theme.light': '浅色主题',
  'theme.dark.graphite': '石墨黑',
  'theme.dark.warm-night': '暖夜',
  'theme.dark.midnight': '午夜蓝',
  'theme.dark.neon': '霓虹终端',
  'theme.light.classic': '经典浅色',
  'theme.light.warm-paper': '暖纸',
  'theme.light.clear-sky': '晴空',

  'lang.system': '系统默认',
  'lang.zh': '中文',
  'lang.en': 'English',

  'storage.notFound': '未找到',
  'storage.copy': '复制',
  'storage.copied': '已复制',
  'storage.hint': '宠物包保存在 Codex 的宠物库目录，桌宠只读不改。',
  'system.source': '来源工具',
  'system.noAgents': '暂无连接',
  'system.version': '版本',
  'system.protocol': '线协议',

  'search.pets.placeholder': '搜索宠物（名称 / 描述 / 来源目录）',
  'search.market.placeholder': '搜索市场（名称 / 作者 / 类型）',

  'pets.local': '本地宠物',
  'pets.refresh': '刷新',
  'pets.hint': '宠物库直接读取 Codex 的 ~/.codex/pets/，桌宠不复制、不导入、不删除。',
  'pets.empty': '本地宠物库为空。',
  'pets.noMatch': '没有匹配的宠物。',
  'pet.noneCard': '不选择宠物',
  'pet.noneCardHint': '隐藏桌宠上的宠物',
  'pet.current': '当前',
  'pet.use': '使用',
  'pet.delete': '删除',
  'pet.deleteConfirm': '确定删除「{name}」吗？将从本地宠物库移除。',
  'pet.setAs': '设为桌宠',
  'pet.setAsDone': '已设为桌宠',
  'pet.sourcePrefix': '来源：{dir}',

  'market.allKinds': '全部类型',
  'market.online': '在线市场',
  'market.hint': '宠物由 petdex.dev 提供；安装写入 ~/.codex/pets/<slug>/，可在「宠物」页选用。',
  'market.loading': '加载市场中…',
  'market.count': '共 {n} 个宠物',
  'market.failed': '市场加载失败',
  'market.loadFailedBody': '市场加载失败: {message}',
  'market.prev': '‹ 上一页',
  'market.next': '下一页 ›',
  'market.page': '第 {x} / {y} 页',
  'market.empty': '没有匹配的市场宠物。',
  'market.install': '安装',
  'market.installing': '安装中',
  'market.installed': '已安装',
  'market.uninstall': '卸载',
  'market.uninstalling': '卸载中…',
  'market.viewOnPetdex': '在 petdex 查看 ›',
  'market.noDesc': '（无描述）',

  'tray.title': '活动',
  'tray.titleCount': '活动 ({n})',
  'tray.empty': '暂无活动',
  'tray.expand': '展开活动列表',
  'tray.collapse': '收起活动列表',
  'tray.connectError': '连接错误：{message}',
  'tray.connecting': '正在连接桌宠服务…',

  'pet.offline': '未连接',
  'menu.settings': '设置',
  'menu.hide': '隐藏',
}

const EN: Dict = {
  'app.name': 'Desktop Pet',
  'title.settings': 'Desktop Pet Settings',
  'title.pet': 'Desktop Pet',
  'title.tray': 'Activity',

  'nav.settings': 'Settings',
  'nav.pets': 'Pets',
  'nav.market': 'Market',

  'page.settings.title': 'Settings',
  'page.pets.title': 'Pets',
  'page.market.title': 'Market',
  'page.settings.subtitle': 'Manage the pet, zoom, wake and pet library.',
  'page.pets.subtitle': 'Manage local pets.',
  'page.market.subtitle': 'Discover and install more pets from petdex.dev.',

  'status.connecting': 'Connecting…',
  'status.offline': 'Offline',
  'status.online': 'Connected',
  'status.noTools': 'Not connected from any tool',
  'status.connectedTo': 'Connected: {agents}',

  'error.offline': 'Cannot reach the pet service; settings are shown offline',

  'group.pet': 'Pet',
  'group.appearance': 'Appearance',
  'group.system': 'System',

  'card.pet': 'Current Pet',
  'card.zoom': 'Zoom',
  'card.wake': 'Wake',
  'card.theme': 'Theme',
  'card.language': 'Language',
  'card.storage': 'Storage',
  'card.system': 'System',

  'pet.hint1': 'The desktop pet follows task status on your desktop.',
  'pet.hint2': 'To pick or browse the library, go to the Pets page.',
  'pet.choose': 'Choose on Pets page',
  'pet.unselected': 'None selected',
  'zoom.hint': 'Hold Ctrl and scroll on the pet window to resize it.',
  'wake.label': 'Show / hide automatically with sessions',
  'wake.hint': 'When off, the pet stays hidden regardless of task status.',

  'theme.mode': 'Mode',
  'theme.mode.system': 'System',
  'theme.mode.dark': 'Dark',
  'theme.mode.light': 'Light',
  'theme.dark': 'Dark theme',
  'theme.light': 'Light theme',
  'theme.dark.graphite': 'Graphite',
  'theme.dark.warm-night': 'Warm Night',
  'theme.dark.midnight': 'Midnight Blue',
  'theme.dark.neon': 'Neon Terminal',
  'theme.light.classic': 'Classic Light',
  'theme.light.warm-paper': 'Warm Paper',
  'theme.light.clear-sky': 'Clear Sky',

  'lang.system': 'System default',
  'lang.zh': '中文',
  'lang.en': 'English',

  'storage.notFound': 'Not found',
  'storage.copy': 'Copy',
  'storage.copied': 'Copied',
  'storage.hint': 'Pet packs live in the Codex pet library directory; the pet only reads it.',
  'system.source': 'Source tools',
  'system.noAgents': 'No connections',
  'system.version': 'Version',
  'system.protocol': 'Wire protocol',

  'search.pets.placeholder': 'Search pets (name / description / source dir)',
  'search.market.placeholder': 'Search market (name / author / kind)',

  'pets.local': 'Local Pets',
  'pets.refresh': 'Refresh',
  'pets.hint': 'The library reads ~/.codex/pets/ directly; nothing is copied, imported or deleted.',
  'pets.empty': 'The local pet library is empty.',
  'pets.noMatch': 'No matching pets.',
  'pet.noneCard': 'No pet',
  'pet.noneCardHint': 'Hide the pet on the desktop',
  'pet.current': 'Current',
  'pet.use': 'Use',
  'pet.delete': 'Delete',
  'pet.deleteConfirm': 'Delete "{name}"? It will be removed from the local pet library.',
  'pet.setAs': 'Set as pet',
  'pet.setAsDone': 'Current pet',
  'pet.sourcePrefix': 'Source: {dir}',

  'market.allKinds': 'All kinds',
  'market.online': 'Online Market',
  'market.hint': 'Pets come from petdex.dev; installing writes to ~/.codex/pets/<slug>/, pick them up on the Pets page.',
  'market.loading': 'Loading market…',
  'market.count': '{n} pets total',
  'market.failed': 'Market failed to load',
  'market.loadFailedBody': 'Market failed to load: {message}',
  'market.prev': '‹ Prev',
  'market.next': 'Next ›',
  'market.page': 'Page {x} / {y}',
  'market.empty': 'No matching market pets.',
  'market.install': 'Install',
  'market.installing': 'Installing',
  'market.installed': 'Installed',
  'market.uninstall': 'Uninstall',
  'market.uninstalling': 'Uninstalling…',
  'market.viewOnPetdex': 'View on petdex ›',
  'market.noDesc': '(No description)',

  'tray.title': 'Activity',
  'tray.titleCount': 'Activity ({n})',
  'tray.empty': 'No activity',
  'tray.expand': 'Expand activity list',
  'tray.collapse': 'Collapse activity list',
  'tray.connectError': 'Connection error: {message}',
  'tray.connecting': 'Connecting to pet service…',

  'pet.offline': 'Offline',
  'menu.settings': 'Settings',
  'menu.hide': 'Hide',
}

const DICTS: Record<LanguageCode, Dict> = { zh: ZH, en: EN }

let current: LanguageCode = 'zh'

/**
 * 解析生效语言：显式选择优先；「system」按 navigator 语言（Tauri WebView
 * 反映操作系统语言），非 zh 开头一律回英文。
 */
export function resolveLanguage(setting: LanguageId | null | undefined, navLanguage?: string): LanguageCode {
  if (setting === 'zh' || setting === 'en') return setting
  const nav = (navLanguage ?? (typeof navigator !== 'undefined' ? navigator.language : '')).toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

export function currentLanguage(): LanguageCode {
  return current
}

export function setLanguage(code: LanguageCode): void {
  current = code
}

/** 取词；支持 {name} 占位符。缺 key 时回退中文，再回退 key 本身。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw = DICTS[current][key] ?? ZH[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
}
