import {
  createTracker,
  type CommonPluginOptions,
  type CustomerType,
  type PluginFootprint,
  type RumPlugin,
  type Tracker,
} from '@kyletaylored/datadog-rum-community-plugins'
import { cartCurrency, cartValue, itemCounts, lineValue, toItems, toPurchase } from './mapping.js'
import type { WooCart, WooCartItem, WooGlobalPayload, WooOrderPayload } from './types.js'

export const PLUGIN_VERSION = '0.1.0'

/** Where the WordPress plugin prints store, customer and order data. */
export const DATA_GLOBAL = 'ddRumWooCommerce'

/**
 * Cart and Checkout block events. Woo dispatches these on `document.body` with the cart in
 * `event.detail`. The jQuery `added_to_cart` event covers classic (non-block) themes.
 * @see https://developer.woocommerce.com/docs/block-development/cart-and-checkout-blocks/dom-events/
 */
export const WOO_EVENTS = [
  'wc-blocks_added_to_cart',
  'wc-blocks_removed_from_cart',
  'wc-blocks_product_list_rendered',
  'added_to_cart',
  'removed_from_cart',
] as const

export const FOOTPRINT: PluginFootprint = {
  globals: [`window.${DATA_GLOBAL}`, 'window.jQuery', 'document.body'],
  events: [...WOO_EVENTS],
  storageKeys: [],
  rumApis: ['addAction', 'setGlobalContextProperty', 'setUser', 'clearUser'],
  consentSource: 'WP Consent API (via the consent option or a consent plugin)',
}

export interface WooCommercePluginOptions extends CommonPluginOptions {
  /**
   * Where to read the server-rendered store, customer and order data. Defaults to
   * `window.ddRumWooCommerce`, which the companion WordPress plugin prints.
   */
  dataGlobal?: string
  /** Supply the payload directly instead of reading a global. Used in tests and headless setups. */
  data?: WooGlobalPayload
  /** Element the Woo block events are dispatched on. Defaults to `document.body`. */
  target?: EventTarget
}

interface WooEventDetail {
  cart?: WooCart
  /** Set by `wc-blocks_added_to_cart` / `removed_from_cart` for the item that changed. */
  product?: WooCartItem
  productId?: number | string
  quantity?: number
}

function readGlobal(name: string): WooGlobalPayload | undefined {
  const value = (globalThis as Record<string, unknown>)[name]
  return value && typeof value === 'object' ? (value as WooGlobalPayload) : undefined
}

function findItem(cart: WooCart | undefined, id: unknown): WooCartItem | undefined {
  if (!cart?.items || id === undefined || id === null) return undefined
  return cart.items.find((item) => String(item.id) === String(id) || item.key === String(id))
}

function isCustomerType(value: unknown): value is CustomerType {
  return value === 'guest' || value === 'new' || value === 'returning'
}

/**
 * Reads WooCommerce's own storefront events and the order data the companion WordPress plugin
 * prints on the order-received page, and maps them onto the shared `commerce` schema.
 *
 * Order data cannot come from the browser alone — Woo exposes no client-side order object — so
 * `commerce.purchase` fires only when a server-rendered payload is present. That payload is also
 * the only place email and name can come from, and both stay off unless opted in.
 */
export function wooCommercePlugin(options: WooCommercePluginOptions = {}): RumPlugin {
  return {
    name: 'woocommerce',
    onInit({ initConfiguration, publicApi }) {
      const tracker = createTracker({
        platform: 'woocommerce',
        version: PLUGIN_VERSION,
        publicApi,
        initConfiguration,
        options,
        footprint: FOOTPRINT,
      })

      const data = options.data ?? readGlobal(options.dataGlobal ?? DATA_GLOBAL)

      if (data?.store) tracker.setStore(data.store)
      if (isCustomerType(data?.customer?.type)) tracker.setCustomerType(data.customer.type)

      if (data?.customer?.id !== undefined && data.customer.id !== '') {
        tracker.identify({
          id: String(data.customer.id),
          email: data.customer.email,
          name: data.customer.name,
        })
      }

      // The order-received page is the only place a purchase can be observed.
      if (data?.order) trackOrder(tracker, data.order)

      const target = options.target ?? (globalThis as { document?: Document }).document?.body
      if (!target) {
        tracker.logger.warn('no document.body to listen on; storefront cart events are off')
        return
      }

      for (const event of WOO_EVENTS) {
        target.addEventListener(event, (raw) => handleWooEvent(tracker, event, raw as CustomEvent<WooEventDetail>))
      }

      tracker.logger.info(`listening for ${WOO_EVENTS.length} WooCommerce events`)
    },
  }
}

/** Fire `commerce.purchase` from a server-rendered order payload. */
export function trackOrder(tracker: Tracker, order: WooOrderPayload): void {
  if (!order.transaction_id) {
    tracker.logger.warn('order payload has no transaction_id; skipping purchase')
    return
  }
  tracker.track('purchase', toPurchase(order))
}

function handleWooEvent(tracker: Tracker, event: string, raw: CustomEvent<WooEventDetail>): void {
  const detail = raw.detail ?? {}
  const cart = detail.cart
  const currency = cartCurrency(cart)

  switch (event) {
    case 'wc-blocks_added_to_cart':
    case 'added_to_cart': {
      const item = detail.product ?? findItem(cart, detail.productId)
      tracker.track('add_to_cart', {
        value: lineValue(item, detail.quantity) ?? cartValue(cart?.totals),
        currency,
        cart_id: cart?.cart_key,
        items: toItems(item ? [item] : cart?.items),
        ...itemCounts(item ? [item] : cart?.items),
      })
      break
    }

    case 'wc-blocks_removed_from_cart':
    case 'removed_from_cart': {
      const item = detail.product ?? findItem(cart, detail.productId)
      tracker.track('remove_from_cart', {
        value: lineValue(item, detail.quantity) ?? cartValue(cart?.totals),
        currency,
        cart_id: cart?.cart_key,
        items: toItems(item ? [item] : undefined),
        ...itemCounts(item ? [item] : undefined),
      })
      break
    }

    case 'wc-blocks_product_list_rendered': {
      tracker.track('view_item_list', {
        item_list_name: (raw.detail as { listName?: string } | undefined)?.listName,
        items: toItems(cart?.items),
      })
      break
    }

    default:
      tracker.logger.dropped(event, 'no schema event for this platform event')
  }
}

/**
 * Call from the Cart and Checkout blocks' own hooks where the DOM events don't cover a step.
 * Exported so the WordPress plugin, or a theme, can drive the checkout funnel explicitly.
 */
export function createCheckoutReporter(tracker: Tracker) {
  return {
    viewCart(cart: WooCart): void {
      tracker.track('view_cart', {
        value: cartValue(cart.totals),
        currency: cartCurrency(cart),
        cart_id: cart.cart_key,
        items: toItems(cart.items),
        ...itemCounts(cart.items),
      })
    },
    beginCheckout(cart: WooCart): void {
      tracker.track('begin_checkout', {
        value: cartValue(cart.totals),
        currency: cartCurrency(cart),
        cart_id: cart.cart_key,
        coupon: cart.coupons?.[0]?.code,
        items: toItems(cart.items),
        ...itemCounts(cart.items),
      })
    },
    addShippingInfo(cart: WooCart, shippingTier?: string): void {
      tracker.track('add_shipping_info', {
        value: cartValue(cart.totals),
        currency: cartCurrency(cart),
        shipping_tier: shippingTier,
      })
    },
    addPaymentInfo(cart: WooCart, paymentType?: string): void {
      tracker.track('add_payment_info', {
        value: cartValue(cart.totals),
        currency: cartCurrency(cart),
        payment_type: paymentType,
      })
    },
    search(term: string): void {
      tracker.track('search', { search_term_length: term.length })
    },
  }
}

export type { WooCart, WooCartItem, WooGlobalPayload, WooOrderPayload } from './types.js'
export default wooCommercePlugin
