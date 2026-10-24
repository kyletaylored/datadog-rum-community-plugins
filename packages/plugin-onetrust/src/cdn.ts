// CDN entry: registers on window.DD_RUM_PLUGINS['onetrust']() so a merchant pastes one script tag.
import { oneTrustPlugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
registry['onetrust'] = oneTrustPlugin

export { oneTrustPlugin }
