import {
  createTracker,
  COMMERCE_FAMILY,
  type CommonPluginOptions,
  type CustomerType,
  type PluginFootprint,
  type RumPlugin,
  type Tracker,
} from '@kyletaylored/datadog-rum-community-plugins'
import { cartCurrency, cartValue, itemCounts, lineValue, toItems, toPurchase } from './mapping.js'
import type { WooCart, WooCartItem, WooGlobalPayload, WooOrderPayload } from './types.js'

export const PLUGIN_VERSION = '0.2.0'

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
  /** Set by `wc-blocks_product_list_rendered`. */
  listName?: string
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
  const plugin: RumPlugin = {
    name: 'woocommerce',
    onInit({ initConfiguration, publicApi }) {
      const tracker = createTracker({
        platform: 'woocommerce',
        version: PLUGIN_VERSION,
        publicApi,
        families: [COMMERCE_FAMILY],
        initConfiguration,
        options,
        footprint: FOOTPRINT,
      })

      trackers.set(plugin, tracker)

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
        target.addEventListener(event, (raw) => handleWooEvent(tracker, event, (raw as CustomEvent<WooEventDetail>).detail))
      }

      // Classic themes raise added_to_cart and removed_from_cart with jQuery's trigger(), which
      // never reaches a native listener, so listen through jQuery too when the page has it. The
      // event carries (fragments, cart_hash, $button): no cart, so the product comes from the button.
      const jQuery = (globalThis as { jQuery?: JQueryLike }).jQuery
      if (typeof jQuery === 'function') {
        jQuery(target).on('added_to_cart removed_from_cart', (event, _fragments, _hash, button) =>
          handleWooEvent(tracker, event.type, fromButton(button)),
        )
      }

      tracker.logger.info(`listening for ${WOO_EVENTS.length} WooCommerce events`)
    },
  }
  return plugin
}

/** Each plugin instance's tracker, once `onInit` has run, so a reporter can be built from the instance. */
const trackers = new WeakMap<RumPlugin, Tracker>()

/** Fire `commerce.purchase` from a server-rendered order payload. */
export function trackOrder(tracker: Tracker, order: WooOrderPayload): void {
  // A payload without a transaction_id is dropped by the core, which cannot deduplicate it.
  tracker.track('purchase', toPurchase(order))
}

/** The slice of jQuery the plugin uses: `$(element).on(types, handler)`. */
type JQueryLike = (target: EventTarget) => {
  on: (types: string, handler: (event: { type: string }, ...args: unknown[]) => void) => unknown
}

/**
 * The product a classic theme's add-to-cart button names. Woo passes the button as a jQuery
 * object (`$thisbutton`). The event carries no price, so none is sent.
 */
function fromButton(button: unknown): WooEventDetail {
  const read = (name: string) => (button as { attr?: (name: string) => string | undefined } | undefined)?.attr?.(name)
  const id = read('data-product_id')
  return id ? { product: { id, sku: read('data-product_sku'), quantity: Number(read('data-quantity')) || 1 } } : {}
}

function handleWooEvent(tracker: Tracker, event: string, raw: WooEventDetail | undefined): void {
  const detail = raw ?? {}
  const cart = detail.cart

  if (event === 'wc-blocks_product_list_rendered') {
    tracker.track('view_item_list', { item_list_name: detail.listName, items: toItems(cart?.items) })
    return
  }

  // Nothing to report. This is also what Woo's block scripts re-dispatch natively for a classic
  // theme's jQuery add, which the jQuery listener has already reported, so it is not counted twice.
  if (!cart && !detail.product && detail.productId === undefined) {
    tracker.logger.dropped(event, 'no cart or product in the event')
    return
  }

  // Every other event is an add or a remove, which carry the same payload; only the schema event
  // differs. An add that names no item reports the cart; a remove reports only what it can name.
  const added = event.endsWith('added_to_cart')
  const item = detail.product ?? findItem(cart, detail.productId)
  const lines = item ? [item] : added ? cart?.items : undefined
  tracker.track(added ? 'add_to_cart' : 'remove_from_cart', {
    value: lineValue(item, detail.quantity) ?? cartValue(cart?.totals),
    currency: cartCurrency(cart),
    cart_id: cart?.cart_key,
    items: toItems(lines),
    ...itemCounts(lines),
  })
}

/**
 * Call from the Cart and Checkout blocks' own hooks where the DOM events don't cover a step.
 * Exported so the WordPress plugin, or a theme, can drive the checkout funnel explicitly.
 *
 * Pass the plugin instance given to `init` (the CDN route, where there is no tracker to hand) or a
 * tracker. An instance is resolved when a step is reported, so the reporter can be made before
 * `init` runs; a step reported before then is dropped with a console warning, never queued.
 */
function isTracker(source: Tracker | RumPlugin): source is Tracker {
  return typeof (source as Partial<Tracker>).track === 'function'
}

export function createCheckoutReporter(source: Tracker | RumPlugin) {
  /** Every step sends the cart's value and currency, when there is a cart, plus its own fields. */
  const send = (step: string, cart: WooCart | undefined, fields: Record<string, unknown>): void => {
    const tracker = isTracker(source) ? source : trackers.get(source)
    if (!tracker) {
      globalThis.console?.warn(`[dd-rum:woocommerce] ${step} dropped: plugin has not been initialized`)
      return
    }
    tracker.track(step, cart ? { value: cartValue(cart.totals), currency: cartCurrency(cart), ...fields } : fields)
  }
  const lines = (cart: WooCart) => ({ cart_id: cart.cart_key, items: toItems(cart.items), ...itemCounts(cart.items) })
  return {
    viewCart: (cart: WooCart): void => send('view_cart', cart, lines(cart)),
    beginCheckout: (cart: WooCart): void => send('begin_checkout', cart, { ...lines(cart), coupon: cart.coupons?.[0]?.code }),
    addShippingInfo: (cart: WooCart, shippingTier?: string): void => send('add_shipping_info', cart, { shipping_tier: shippingTier }),
    addPaymentInfo: (cart: WooCart, paymentType?: string): void => send('add_payment_info', cart, { payment_type: paymentType }),
    search: (term: string): void => send('search', undefined, { search_term_length: term.length }),
  }
}

export type { WooCart, WooCartItem, WooGlobalPayload, WooOrderPayload } from './types.js'
export default wooCommercePlugin
