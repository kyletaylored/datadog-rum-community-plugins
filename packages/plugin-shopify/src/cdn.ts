// CDN entry: registers on window.DD_RUM_PLUGINS['shopify']().
import { shopifyPlugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
registry['shopify'] = shopifyPlugin

export { shopifyPlugin }
