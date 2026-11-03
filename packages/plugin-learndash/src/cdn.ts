// CDN entry: registers on window.DD_RUM_PLUGINS['learndash']() so a merchant pastes one script tag.
// Bracket notation, because an adapter name may contain hyphens.
import { learndashPlugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
registry['learndash'] = learndashPlugin

export { learndashPlugin }
