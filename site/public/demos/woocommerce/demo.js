/**
 * Thread & Co., the WooCommerce demo store.
 *
 * Every cart event is a real WooCommerce DOM event on `document.body`, with a Store API cart
 * built from the plugin's recorded fixtures. Cart, checkout and search, which have no DOM event,
 * go through the plugin's checkout reporter, as the companion WordPress plugin drives them. The order on the thank-you page is the recorded
 * `order received` payload, card number and billing address included, exactly as the companion
 * WordPress plugin would print it.
 */
import { startDemo } from '../_shared/bridge.js'

const fixtures = window.DDRumDemoFixtures.woocommerce
const page = document.body.dataset.page

// ---- Catalogue and cart, from the fixtures --------------------------------------------------

const added = fixtures['added to cart'].payload
const native = fixtures['added to cart, as a native DOM event'].payload
const jqueryAdd = fixtures['added to cart on a classic theme, through jQuery'].payload
const order = fixtures['order received'].payload

/** Store API cart items, keyed by product ID. Socks come from the native-event recording. */
const CATALOGUE = Object.fromEntries(
  [...added.cart.items, ...native.cart.items].map((item) => [String(item.id), item]),
)
const CART_KEY = added.cart.cart_key
const CURRENCY = { currency_code: 'USD', currency_minor_unit: 2 }
/** The classic-theme product: added from the grid the way Woo's classic script does, through jQuery. */
const CLASSIC_ID = jqueryAdd.button['data-product_id']

/**
 * A classic theme's jQuery: just `$(element).on(types, handler)` and `.trigger(type, args)`, enough
 * for the plugin to listen through and for the socks button to raise `added_to_cart` the way Woo's
 * add-to-cart.js does. A jQuery-only event never reaches a native listener, which is the point.
 */
const jqueryHandlers = new Map()
window.jQuery = (element) => ({
  on(types, handler) {
    for (const type of types.split(' ')) jqueryHandlers.set(type, [...(jqueryHandlers.get(type) ?? []), handler])
    return this
  },
  trigger(type, args = []) {
    for (const handler of jqueryHandlers.get(type) ?? []) handler({ type, target: element }, ...args)
    return this
  },
})
/** Woo passes the add-to-cart link as a jQuery object; the plugin reads its data-* attributes. */
const button = (attributes) => ({ attr: (name) => attributes[name] })

const minor = (item) => Number(item.prices.price)
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`

/** One per sandbox preset, by id. The presets differ only in the options they start with. */
export const scenarios = {
  'happy-path': visit(),
  'cookie-banner-unanswered': visit(),
  'send-the-email-address': visit(),
}

const PAGE_NAMES = { shop: 'Shop', product: 'Product', cart: 'Cart', checkout: 'Checkout', thanks: 'Thank-you' }

const demo = startDemo({
  plugin: 'woocommerce',
  page: PAGE_NAMES[page],
  defaults: { consent: 'ignore' },
  scenarios,
})

function lines() {
  return demo.state('cart') ?? {}
}

/** The cart as Woo's Store API shapes it, which is what the block events carry in `detail.cart`. */
function storeCart(quantities = lines()) {
  const items = Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const item = CATALOGUE[id]
      return { ...item, quantity, totals: { line_total: String(minor(item) * quantity), ...CURRENCY } }
    })
  const total = items.reduce((sum, item) => sum + Number(item.totals.line_total), 0)
  return {
    cart_key: CART_KEY,
    items_count: items.reduce((sum, item) => sum + item.quantity, 0),
    totals: { total_price: String(total), total_items: String(total), ...CURRENCY },
    items,
  }
}

function addToCart(id, quantity) {
  const next = { ...lines(), [id]: (lines()[id] ?? 0) + quantity }
  demo.state('cart', next)
  if (id === CLASSIC_ID) {
    // Woo's classic add-to-cart.js: $(document.body).trigger('added_to_cart', [fragments, cart_hash, $button])
    const { fragments, cart_hash: cartHash, button: attributes } = jqueryAdd
    demo.as('jQuery added_to_cart (classic theme)', () => {
      window.jQuery(document.body).trigger('added_to_cart', [fragments, cartHash, button({ ...attributes, 'data-quantity': String(quantity) })])
    })
  } else {
    const detail = { productId: Number(id), quantity, cart: storeCart(next) }
    demo.as('wc-blocks_added_to_cart', () => {
      document.body.dispatchEvent(new CustomEvent('wc-blocks_added_to_cart', { detail }))
    })
  }
  paintCount()
}

function removeFromCart(id) {
  // Woo sends the cart as it was, with the removed line still in it.
  const before = lines()
  const detail = { productId: Number(id), quantity: before[id], cart: storeCart(before) }
  demo.state('cart', { ...before, [id]: 0 })
  demo.as('wc-blocks_removed_from_cart', () => {
    document.body.dispatchEvent(new CustomEvent('wc-blocks_removed_from_cart', { detail }))
  })
}

// ---- Start the plugin -------------------------------------------------------------------------

// The WordPress plugin prints store and customer on every page, and the order only on the
// order-received page. The plugin reads this global at init, so it is set first.
window.ddRumWooCommerce = page === 'thanks' ? order : { store: order.store, customer: order.customer }
const woo = window.DD_RUM_PLUGINS.woocommerce(demo.options)
demo.init(woo, {
  source: page === 'thanks' ? 'ddRumWooCommerce.order' : 'window.ddRumWooCommerce',
  payload: page === 'thanks' ? order.order : undefined,
})

/**
 * Cart, checkout and search have no WooCommerce DOM event. The companion WordPress plugin reports
 * them from the Cart and Checkout blocks' hooks through the plugin's own checkout reporter, which
 * the CDN bundle exposes; the demo calls it at the same moments, with the Store API cart.
 */
const checkout = window.DD_RUM_PLUGINS.woocommerce.createCheckoutReporter(woo)
function report(step, payload, send) {
  demo.as(`createCheckoutReporter.${step}`, send, { payload })
}

/** The checkout's cart: the Store API cart, with the coupon the summary shows applied. */
const checkoutCart = () => ({ ...storeCart(), coupons: [{ code: 'WELCOME10' }] })

// ---- Pages ------------------------------------------------------------------------------------

function paintCount() {
  const count = Object.values(lines()).reduce((sum, quantity) => sum + quantity, 0)
  for (const element of document.querySelectorAll('[data-cart-count]')) element.textContent = String(count)
}

document.querySelector('[data-search]')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const term = event.currentTarget.value
    report('search', { term }, () => checkout.search(term))
  }
})

if (page === 'shop') {
  const grid = document.querySelector('[data-grid]')
  for (const item of Object.values(CATALOGUE)) {
    const card = document.createElement('article')
    card.className = 'card'
    const name = String(item.id) === '184'
      ? `<a href="product.html" data-product="${item.id}">${item.name}</a>`
      : item.name
    card.innerHTML = `<div class="ph">product shot</div><h2>${name}</h2><p class="price">${dollars(minor(item))}</p>
      <button type="button" data-add="${item.id}">Add to cart</button>`
    card.querySelector('button').addEventListener('click', () => addToCart(String(item.id), 1))
    grid.append(card)
  }
  demo.as('wc-blocks_product_list_rendered', () => {
    document.body.dispatchEvent(
      new CustomEvent('wc-blocks_product_list_rendered', {
        detail: { listName: 'Shirts & accessories', cart: { items: Object.values(CATALOGUE) } },
      }),
    )
  })
}

if (page === 'product') {
  const tee = CATALOGUE['184']
  document.querySelector('[data-product-name]').textContent = tee.name
  document.querySelector('[data-product-price]').textContent = dollars(minor(tee))
  const output = document.querySelector('[data-qty]')
  const quantity = () => Number(output.textContent)
  document.querySelector('[data-qty-up]').addEventListener('click', () => { output.textContent = String(quantity() + 1) })
  document.querySelector('[data-qty-down]').addEventListener('click', () => { output.textContent = String(Math.max(1, quantity() - 1)) })
  document.querySelector('[data-add-to-cart]').addEventListener('click', () => addToCart('184', quantity()))
}

if (page === 'cart') {
  const paint = () => {
    const cart = storeCart()
    const list = document.querySelector('[data-lines]')
    list.replaceChildren()
    if (cart.items.length === 0) list.innerHTML = '<p class="muted">Your cart is empty. <a href="index.html">Back to the shop</a></p>'
    for (const item of cart.items) {
      const row = document.createElement('div')
      row.className = 'line'
      const variant = item.variation?.map((entry) => entry.value).join(' / ') || item.categories?.[0]?.name || ''
      row.innerHTML = `<div class="ph">item</div><div><strong>${item.name}</strong><span class="muted">${variant} · qty ${item.quantity}</span></div>
        <span>${dollars(Number(item.totals.line_total))}</span><button type="button" data-remove="${item.id}">Remove</button>`
      row.querySelector('button').addEventListener('click', () => { removeFromCart(String(item.id)); paint(); paintCount() })
      list.append(row)
    }
    document.querySelector('[data-subtotal]').textContent = dollars(Number(cart.totals.total_price))
  }
  paint()
  const cart = storeCart()
  report('viewCart', cart, () => checkout.viewCart(cart))
}

if (page === 'checkout') {
  const tax = 620
  const shipping = { Ground: 495, Express: 1400 }
  const paint = () => {
    const cart = storeCart()
    const chosen = demo.state('ship') ?? 'Ground'
    const rows = cart.items.map((item) => `<p>${item.name} × ${item.quantity} <span>${dollars(Number(item.totals.line_total))}</span></p>`)
    const total = Number(cart.totals.total_price) + shipping[chosen] + tax
    document.querySelector('[data-order-summary]').innerHTML = `${rows.join('')}
      <p>Coupon WELCOME10 <span>applied</span></p><p>Shipping <span>${dollars(shipping[chosen])}</span></p>
      <p>Tax <span>${dollars(tax)}</span></p><p class="total">Total <span>${dollars(total)}</span></p>`
  }
  for (const input of document.querySelectorAll('[data-ship]')) {
    input.addEventListener('change', () => {
      demo.state('ship', input.value)
      paint()
      const cart = checkoutCart()
      report('addShippingInfo', cart, () => checkout.addShippingInfo(cart, input.value))
    })
  }
  for (const input of document.querySelectorAll('[data-pay]')) {
    input.addEventListener('change', () => {
      document.querySelector('[data-card]').hidden = input.value !== 'card'
      const cart = checkoutCart()
      report('addPaymentInfo', cart, () => checkout.addPaymentInfo(cart, input.value))
    })
  }
  paint()
  const cart = checkoutCart()
  report('beginCheckout', cart, () => checkout.beginCheckout(cart))
}

if (page === 'thanks') {
  demo.state('cart', {})
  const paymentNames = { paypal: 'PayPal', card: 'Credit card' }
  document.querySelector('[data-order]').innerHTML = `<div><dt>Order</dt><dd>#${order.order.transaction_id.replace(/^wc_/, '')}</dd></div>
    <div><dt>Total</dt><dd>$${order.order.value.toFixed(2)}</dd></div>
    <div><dt>Payment</dt><dd>${paymentNames[order.order.payment_type] ?? order.order.payment_type}</dd></div>`
  // A real reload: a fresh page, a fresh plugin, the same order. The dedupe refuses it.
  document.querySelector('[data-reload]').addEventListener('click', () => demo.reload())
}

paintCount()
demo.ready()

// ---- Scenarios --------------------------------------------------------------------------------

/** One visit through the store, driving the real buttons and links. */
function visit() {
  return [
    (d) => d.type('[data-search]', 'red tee medium'),
    (d) => d.press('[data-search]', 'Enter'),
    (d) => d.click('[data-add="190"]'),
    (d) => d.click(`[data-add="${CLASSIC_ID}"]`),
    (d) => d.follow('[data-product="184"]'),
    (d) => d.click('[data-add-to-cart]'),
    (d) => d.follow('[data-cart-link]'),
    (d) => d.click('[data-remove="190"]'),
    (d) => d.follow('[data-checkout]'),
    (d) => d.click('[data-ship="Ground"]'),
    (d) => d.click('[data-pay="paypal"]'),
    (d) => d.follow('[data-place-order]'),
  ]
}

/**
 * Which interaction reaches each action the plugin declares. `npm run lint:demos` checks every
 * declared action appears here, and the browser test checks each one is really sent.
 */
export const coverage = {
  reachable: {
    'commerce.view_item_list': 'the shop page loads',
    'commerce.add_to_cart': 'Add to cart, from the grid or the product page',
    'commerce.remove_from_cart': 'Remove, on the cart page',
    'commerce.view_cart': 'the cart page loads (createCheckoutReporter)',
    'commerce.begin_checkout': 'the checkout page loads (createCheckoutReporter)',
    'commerce.add_shipping_info': 'choosing a shipping method (createCheckoutReporter)',
    'commerce.add_payment_info': 'choosing a payment method (createCheckoutReporter)',
    'commerce.purchase': 'the order-received page loads',
    'commerce.search': 'Enter in the product search (createCheckoutReporter)',
  },
}
