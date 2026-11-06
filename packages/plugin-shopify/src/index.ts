import {
  createTracker,
  COMMERCE_FAMILY,
  type CommonPluginOptions,
  type PluginFootprint,
  type RumPlugin,
  type Tracker,
} from '@kyletaylored/datadog-rum-community-plugins'
import {
  amount,
  checkoutAttributes,
  checkoutTotals,
  currencyOf,
  itemsFromCartLines,
  itemsFromVariants,
  lineItemCounts,
  paymentTypeOf,
  shippingTierOf,
  toPurchase,
} from './mapping.js'
import { CART_STORAGE_KEY, startStorefront } from './storefront.js'
import type {
  ShopifyAnalyticsApi,
  ShopifyEvent,
  ShopifyStorefrontGlobal,
} from './types.js'

export const PLUGIN_VERSION = '0.2.0'

/**
 * Web Pixel standard events this adapter subscribes to. `page_viewed`, `clicked` and
 * `ui_extension_errored` are deliberately absent: the official `shopifyPlugin` already binds
 * those, and this adapter composes with it rather than replacing it.
 */
export const SHOPIFY_EVENTS = [
  'collection_viewed',
  'product_viewed',
  'product_added_to_cart',
  'product_removed_from_cart',
  'cart_viewed',
  'checkout_started',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
  'search_submitted',
] as const

export const FOOTPRINT: PluginFootprint = {
  globals: ['analytics (Web Pixel sandbox)', 'window.Shopify', 'window.ShopifyAnalytics'],
  // Storefront mode: resource timing entries for the theme's cart.js traffic, and a click.
  events: [...SHOPIFY_EVENTS, 'cart.js', 'click'],
  storageKeys: [CART_STORAGE_KEY],
  rumApis: ['addAction', 'setGlobalContextProperty', 'setUser'],
  consentSource: 'Shopify Customer Privacy API (window.Shopify.customerPrivacy)',
}

export interface ShopifyPluginOptions extends CommonPluginOptions {
  /**
   * The sandbox `analytics` global, the same object the official `shopifyPlugin` takes as
   * `shopifyAnalytics`. Required inside a custom pixel.
   */
  analytics?: ShopifyAnalyticsApi
  /**
   * `pixel` subscribes to `analytics`; `storefront` reads what an Online Store theme exposes to
   * any script (`ShopifyAnalytics.meta` and the Ajax Cart API). `auto` (default) picks `pixel`
   * when `analytics` was passed and `storefront` otherwise.
   */
  mode?: 'auto' | 'pixel' | 'storefront'
}

function storefront(): ShopifyStorefrontGlobal | undefined {
  const value = (globalThis as { Shopify?: unknown }).Shopify
  return value && typeof value === 'object' ? (value as ShopifyStorefrontGlobal) : undefined
}

/**
 * Adds business data to a Shopify RUM install: checkout funnel events, order value and customer
 * identity, mapped onto the shared `commerce` schema.
 *
 * Compose it with the official plugin rather than replacing it. `shopifyPlugin` handles the Web
 * Pixel sandbox (patching `cookieStore`, `navigator.locks` and `document.hasFocus`, disabling
 * replay, resources and auto-tracked interactions) and binds `page_viewed`, `clicked` and
 * `ui_extension_errored`. This adapter subscribes only to the events the official one leaves
 * alone, so both can read the same `analytics` global with no overlap:
 *
 * ```js
 * DD_RUM.init({
 *   plugins: [
 *     DD_RUM.shopifyPlugin({ shopifyAnalytics: analytics }),
 *     DD_RUM_PLUGINS.shopify({ analytics }),
 *   ],
 * })
 * ```
 *
 * It never changes `initConfiguration`; the official plugin owns that.
 */
export function shopifyPlugin(options: ShopifyPluginOptions = {}): RumPlugin {
  return {
    name: 'shopify-community',
    onInit({ initConfiguration, publicApi }) {
      const analytics = options.analytics

      const tracker = createTracker({
        platform: 'shopify',
        version: PLUGIN_VERSION,
        publicApi,
        families: [COMMERCE_FAMILY],
        // Consent is read from Shopify's own Customer Privacy API below, so the gate is not
        // handed `initConfiguration`: the official plugin owns the init options.
        options,
        footprint: FOOTPRINT,
      })

      const shop = storefront()
      if (shop) {
        tracker.setStore({ id: shop.shop, currency: shop.currency?.active, locale: shop.locale })
      }

      // Shopify's Customer Privacy API is the platform's own consent signal. Its answer is
      // recorded on the page, so it gates this plugin and any other, but it never moves the SDK's
      // tracking consent: only a consent plugin does that. With no API on the page (the pixel
      // sandbox, where the Pixel Manager applied consent before the pixel ran) there is no signal
      // to record, and the plugin follows whatever else is on the page.
      if (options.consent === undefined || options.consent === 'auto') {
        const allowed = shop?.customerPrivacy?.analyticsProcessingAllowed?.()
        if (allowed === true) {
          const categories = shop?.customerPrivacy?.currentVisitorConsent?.()
          tracker.consent.grant(categories ? Object.keys(categories).filter((key) => categories[key] === 'yes') : undefined)
        } else if (allowed === false) {
          tracker.consent.deny()
        }
      }

      // Never return false from here: Browser SDK v7 skips init for the whole page when any
      // plugin does. A page with nothing to read gets a warning instead.
      const mode = options.mode ?? 'auto'
      const storefrontMode = mode === 'storefront' || (mode === 'auto' && !analytics)
      if (storefrontMode ? !(globalThis as { ShopifyAnalytics?: unknown }).ShopifyAnalytics : typeof analytics?.subscribe !== 'function') {
        tracker.logger.warn('no ShopifyAnalytics, and no pixel analytics passed: no commerce events are reported')
      }
      if (storefrontMode) {
        startStorefront(tracker)
        return
      }
      if (typeof analytics?.subscribe !== 'function') return

      for (const event of SHOPIFY_EVENTS) {
        analytics.subscribe(event, (payload) => handleShopifyEvent(tracker, payload))
      }

      // `initConfiguration` is intentionally untouched; referenced so the contract stays explicit.
      void initConfiguration
      tracker.logger.info(`subscribed to ${SHOPIFY_EVENTS.length} Web Pixel events`)
    },
  }
}

function handleShopifyEvent(tracker: Tracker, event: ShopifyEvent): void {
  const data = event.data ?? {}
  const checkout = data.checkout

  switch (event.name) {
    case 'collection_viewed':
      tracker.track('view_item_list', {
        item_list_name: data.collection?.title,
        items: itemsFromVariants(data.collection?.productVariants ?? []),
      })
      break

    case 'product_viewed':
      tracker.track('view_item', {
        value: amount(data.productVariant?.price),
        currency: currencyOf(data.productVariant?.price),
        items: itemsFromVariants([data.productVariant]),
      })
      break

    // Added and removed carry the same payload; only the schema event differs.
    case 'product_added_to_cart':
    case 'product_removed_from_cart': {
      const lines = data.cartLine ? [data.cartLine] : undefined
      tracker.track(event.name === 'product_added_to_cart' ? 'add_to_cart' : 'remove_from_cart', {
        value: amount(data.cartLine?.cost?.totalAmount),
        currency: currencyOf(data.cartLine?.cost?.totalAmount, data.cartLine?.merchandise?.price),
        items: itemsFromCartLines(lines),
        ...lineItemCounts(lines),
      })
      break
    }

    case 'cart_viewed':
      tracker.track('view_cart', {
        value: amount(data.cart?.cost?.totalAmount),
        currency: currencyOf(data.cart?.cost?.totalAmount),
        cart_id: data.cart?.id,
        item_count: data.cart?.totalQuantity,
        items: itemsFromCartLines(data.cart?.lines),
      })
      break

    case 'checkout_started':
      tracker.track('begin_checkout', checkoutAttributes(checkout))
      break

    case 'checkout_shipping_info_submitted':
      tracker.track('add_shipping_info', { ...checkoutTotals(checkout), shipping_tier: shippingTierOf(checkout) })
      break

    case 'payment_info_submitted':
      tracker.track('add_payment_info', { ...checkoutTotals(checkout), payment_type: paymentTypeOf(checkout) })
      break

    case 'checkout_completed': {
      if (!checkout) break
      // Identify before the action, so the purchase lands on an identified session.
      const customerId = checkout.order?.customer?.id
      if (customerId !== undefined && customerId !== null && String(customerId) !== '') {
        tracker.identify({ id: String(customerId), email: checkout.email })
      }
      tracker.track('purchase', toPurchase(checkout))
      break
    }

    case 'search_submitted':
      // The query itself never leaves the browser: only its length is sent.
      tracker.track('search', { search_term_length: data.searchResult?.query?.length })
      break

    default:
      tracker.logger.dropped(event.name, 'no schema event for this platform event')
  }
}

export type { ShopifyAnalyticsApi, ShopifyCheckout, ShopifyEvent } from './types.js'
export { CART_STORAGE_KEY } from './storefront.js'
export default shopifyPlugin
