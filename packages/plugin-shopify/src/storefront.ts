import { count, money, sanitizeItems, text, type Tracker } from '@kyletaylored/datadog-rum-community-plugins'
import type { AjaxCart, AjaxCartLine, StorefrontMeta, StorefrontMetaProduct, ShopifyStorefrontGlobal } from './types.js'

/** Where the last cart snapshot is kept, so a cart change on the next page has a baseline. */
export const CART_STORAGE_KEY = 'dd_rum_shopify_cart'

/**
 * Matches the theme's own Ajax Cart API traffic: `cart.js` reads and the add, change, update and
 * clear endpoints, with or without `.js`. Section renders such as `/cart?view=mini-cart` count
 * too, since themes refresh them after a change. The plugin's own read is tagged and skipped.
 */
const CART_REQUEST = /\/cart(\/(add|change|update|clear))?(\.js)?(\?|$)/
const OWN_READ = 'dd_rum=1'

/** A line as kept in the snapshot: only what the schema sends, never `properties` or the description. */
interface SnapshotLine {
  key: string
  quantity: number
  /** `final_price`, in the minor units cart.js uses. */
  cents: number
  item: Record<string, unknown>
}

interface Snapshot {
  token?: string
  currency?: string
  lines: SnapshotLine[]
}

/** cart.js and `ShopifyAnalytics.meta` give money in minor units, for every currency. */
const major = (cents: unknown) => money(typeof cents === 'number' ? cents / 100 : undefined)

/** Shopify names the default variant "Default Title"; that is noise, not a variant. */
const variantName = (name: unknown) => (name === 'Default Title' ? undefined : text(name))

/**
 * The cart token without its `?key=` half, which is a credential for the cart, not an ID.
 * `attributes`, `note` and line `properties` are never read: on real stores they carry the
 * shopper's email address, app tokens and personalisation text.
 */
export function cartId(token: unknown): string | undefined {
  return text(typeof token === 'string' ? token.split('?')[0] : undefined)
}

export function snapshotOf(cart: AjaxCart): Snapshot {
  return {
    token: cartId(cart.token),
    currency: text(cart.currency),
    lines: (cart.items ?? []).map((line: AjaxCartLine) => ({
      key: String(line.key ?? line.variant_id ?? line.id),
      quantity: count(line.quantity) ?? 0,
      cents: typeof line.final_price === 'number' ? line.final_price : (line.price ?? 0),
      item: {
        item_id: text(line.sku) ?? text(line.variant_id),
        item_name: text(line.product_title) ?? text(line.title),
        price: major(line.final_price ?? line.price),
        item_variant: variantName(line.variant_title),
        item_category: text(line.product_type),
      },
    })),
  }
}

/** Attributes for a set of lines at the given quantities: GA4's value, items and counts. */
function lineAttributes(changes: [SnapshotLine, number][], currency: string | undefined) {
  return {
    value: money(changes.reduce((sum, [line, quantity]) => sum + line.cents * quantity, 0) / 100),
    currency,
    items: sanitizeItems(changes.map(([line, quantity]) => ({ ...line.item, quantity }))),
    item_count: changes.reduce((sum, [, quantity]) => sum + quantity, 0),
    unique_items: changes.length,
  }
}

/**
 * What changed between two cart snapshots: the lines whose quantity went up and down, with the
 * difference. Neither cart.js response names the line a shopper added; the difference does, which
 * is why this works whichever way the theme changed the cart.
 */
export function diffCarts(before: Snapshot, after: Snapshot): { added: [SnapshotLine, number][]; removed: [SnapshotLine, number][] } {
  const added: [SnapshotLine, number][] = []
  const removed: [SnapshotLine, number][] = []
  const old = new Map(before.lines.map((line) => [line.key, line]))
  for (const line of after.lines) {
    const delta = line.quantity - (old.get(line.key)?.quantity ?? 0)
    if (delta > 0) added.push([line, delta])
    else if (delta < 0) removed.push([line, -delta])
    old.delete(line.key)
  }
  for (const line of old.values()) if (line.quantity > 0) removed.push([line, line.quantity])
  return { added, removed }
}

function metaItems(products: StorefrontMetaProduct[] | undefined, variantId?: string | null) {
  return sanitizeItems(
    (products ?? []).map((product) => {
      const variants = product.variants ?? []
      const variant = variants.find((candidate) => String(candidate.id) === variantId) ?? variants[0]
      return {
        item_id: text(variant?.sku) ?? text(variant?.id) ?? text(product.id),
        // `name` is "Product - Variant"; with a variant title present, strip it back off.
        item_name: text(variant?.public_title ? variant.name?.replace(` - ${variant.public_title}`, '') : variant?.name),
        price: major(variant?.price),
        quantity: 1,
        item_variant: variantName(variant?.public_title),
        item_category: text(product.type),
      }
    }),
  )
}

export interface StorefrontEnvironment {
  /** Reads the current cart. Defaults to `fetch` against the store's own `cart.js`. */
  readCart?: () => Promise<AjaxCart | undefined>
  storage?: Storage | null
}

export interface Storefront {
  /** Re-read the cart and report what changed. Called by the request observer; exposed for tests. */
  refresh: () => Promise<void>
}

/**
 * The storefront mode: what a theme exposes to any script on the page, for installs outside the
 * Web Pixel sandbox (a theme snippet, a tag manager, the RUM Injector).
 *
 * Page views come from `ShopifyAnalytics.meta`, which every Online Store theme prints. Cart
 * changes come from diffing `cart.js` snapshots: a `PerformanceObserver` notices the theme's cart
 * requests (by URL only; it never sees a body), and the plugin then makes its own read. Nothing on
 * the page is patched: not `fetch`, not XHR, not the theme's code.
 *
 * Checkout, payment and the order happen in Shopify's checkout, which only the pixel can see.
 */
export function startStorefront(tracker: Tracker, env: StorefrontEnvironment = {}): Storefront {
  const scope = globalThis as unknown as {
    Shopify?: ShopifyStorefrontGlobal
    ShopifyAnalytics?: { meta?: StorefrontMeta }
    location?: Location
    document?: Document
    sessionStorage?: Storage
    PerformanceObserver?: typeof PerformanceObserver
    fetch?: typeof fetch
  }
  const meta = scope.ShopifyAnalytics?.meta ?? {}
  const page = meta.page ?? {}
  const params = new URLSearchParams(scope.location?.search ?? '')
  const root = scope.Shopify?.routes?.root ?? '/'
  const currency = text(scope.Shopify?.currency?.active)

  let storage: Storage | undefined
  try {
    storage = env.storage === null ? undefined : (env.storage ?? scope.sessionStorage)
  } catch {
    // Storage blocked: every page starts without a baseline.
  }

  const readCart =
    env.readCart ??
    (() =>
      scope.fetch?.(`${root}cart.js?${OWN_READ}`, { credentials: 'same-origin' }).then((response) =>
        response.ok ? (response.json() as Promise<AjaxCart>) : undefined,
      ) ?? Promise.resolve(undefined))

  let snapshot: Snapshot | undefined
  try {
    const stored = storage?.getItem(CART_STORAGE_KEY)
    if (stored) snapshot = JSON.parse(stored) as Snapshot
  } catch {
    snapshot = undefined
  }

  const customerId = text(page.customerId)
  if (customerId) {
    tracker.identify({ id: customerId })
    tracker.setCustomerType('returning')
  }

  if (page.pageType === 'product' && meta.product) {
    const items = metaItems([meta.product], params.get('variant'))
    tracker.track('view_item', { value: items?.[0]?.price, currency, items })
  } else if (page.pageType === 'collection' && meta.products) {
    tracker.track('view_item_list', { item_list_name: 'collection', items: metaItems(meta.products) })
  } else if (page.pageType === 'searchresults') {
    // The query itself never leaves the browser: only its length is sent.
    tracker.track('search', { search_term_length: (params.get('q') ?? '').length })
  }

  function cartAttributes(current: Snapshot) {
    return {
      ...lineAttributes(current.lines.map((line) => [line, line.quantity]), current.currency ?? currency),
      cart_id: current.token,
    }
  }

  async function refresh(): Promise<void> {
    let cart: AjaxCart | undefined
    try {
      cart = await readCart()
    } catch {
      return
    }
    if (!cart) return
    const next = snapshotOf(cart)
    const previous = snapshot
    snapshot = next
    try {
      storage?.setItem(CART_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage full or blocked: the next page simply has no baseline.
    }
    // No baseline, or a new cart after checkout: nothing to compare against.
    if (!previous || previous.token !== next.token) return
    const { added, removed } = diffCarts(previous, next)
    const cartCurrency = next.currency ?? currency
    if (added.length > 0) tracker.track('add_to_cart', { ...lineAttributes(added, cartCurrency), cart_id: next.token })
    if (removed.length > 0) tracker.track('remove_from_cart', { ...lineAttributes(removed, cartCurrency), cart_id: next.token })
  }

  // The cart page reads the cart for view_cart, and that read also catches a change made by a
  // plain form post (which reloads onto /cart rather than calling the Ajax API). The first page
  // of a session reads it once for a baseline.
  if (page.pageType === 'cart') {
    void refresh().then(() => snapshot && tracker.track('view_cart', cartAttributes(snapshot)))
  } else if (!snapshot) {
    void refresh()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  if (typeof scope.PerformanceObserver === 'function') {
    try {
      new scope.PerformanceObserver((list) => {
        const touched = list
          .getEntries()
          .some((entry) => CART_REQUEST.test(entry.name) && !entry.name.includes(OWN_READ))
        if (!touched) return
        // Themes often fire two or three cart requests per change; read once after they settle.
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 300)
      }).observe({ type: 'resource' })
    } catch {
      // No resource timing: page views still report, cart changes do not.
    }
  }

  // begin_checkout: the shopper heads for checkout. Only the control is looked at (its name or
  // link), never a form field. The value comes from the last cart snapshot.
  scope.document?.addEventListener(
    'click',
    (event) => {
      const control = (event.target as Element | null)?.closest?.('[name="checkout"], a[href*="/checkout"]')
      if (control && snapshot) tracker.track('begin_checkout', cartAttributes(snapshot))
    },
    true,
  )

  return { refresh }
}
