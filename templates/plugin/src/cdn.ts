// CDN entry: registers on window.DD_RUM_PLUGINS['__NAME__']() so a merchant pastes one script tag.
// Bracket notation, because an adapter name may contain hyphens.
import { __NAME_FN__Plugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
registry['__NAME__'] = __NAME_FN__Plugin

export { __NAME_FN__Plugin }
