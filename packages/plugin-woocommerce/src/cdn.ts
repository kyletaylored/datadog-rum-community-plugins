// CDN entry: registers on window.DD_RUM_PLUGINS['woocommerce']().
import { wooCommercePlugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
registry['woocommerce'] = wooCommercePlugin

export { wooCommercePlugin }
