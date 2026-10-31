// CDN entry: registers on window.DD_RUM_PLUGINS['woocommerce'](), with the checkout reporter on it
// as window.DD_RUM_PLUGINS['woocommerce'].createCheckoutReporter(plugin).
import { createCheckoutReporter, wooCommercePlugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
// A wrapper rather than a property on wooCommercePlugin itself, so the npm export stays untouched.
registry['woocommerce'] = Object.assign((options?: Parameters<typeof wooCommercePlugin>[0]) => wooCommercePlugin(options), {
  createCheckoutReporter,
})

export { createCheckoutReporter, wooCommercePlugin }
