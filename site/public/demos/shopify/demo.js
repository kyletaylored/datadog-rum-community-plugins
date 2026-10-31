/**
 * Northline, the Shopify demo store.
 *
 * Every step publishes a Shopify Web Pixels standard event on an `analytics` double, the object a
 * custom pixel receives, and the plugin subscribes to it exactly as it does in a real pixel.
 * Payloads take their shape, and where the visit matches the recording their values, from the
 * plugin's fixtures — card number and CVV included on a card payment, as the fixture records them.
 */
import { startDemo } from '../_shared/bridge.js'

const fixtures = window.DDRumDemoFixtures.shopify
const page = document.body.dataset.page

// ---- Catalogue, from the fixtures -------------------------------------------------------------

const collection = fixtures['collection viewed'].payload.data.collection
const viewed = fixtures['product viewed'].payload.data.productVariant
const paymentRecording = fixtures['payment info submitted, with card data in the payload'].payload.data.checkout
const completed = fixtures['checkout completed'].payload.data.checkout
const completedAgain = fixtures['checkout completed again, same order'].payload.data.checkout
const startedRecording = fixtures['checkout started'].payload.data.checkout

/** Product variants by SKU. The tee is the richer `product viewed` variant, with its IDs. */
const CATALOGUE = Object.fromEntries(
  collection.productVariants.map((variant) => [variant.sku, variant.sku === viewed.sku ? viewed : variant]),
)
const TEE = viewed.sku
const CAP = 'CAP-BLK'
const TAX = startedRecording.totalTax.amount
const SHIPPING = { Ground: 4.95, Express: 14 }
const money = (amount) => ({ amount: Math.round(amount * 100) / 100, currencyCode: 'USD' })
const dollars = (amount) => `$${amount.toFixed(2)}`

/** One per sandbox preset, by id. */
export const scenarios = {
  'happy-path': visit({ pay: 'paypal' }),
  'shopper-declines-cookies': visit({ pay: 'paypal' }),
  'thank-you-page-reloaded': [...visit({ pay: 'paypal' }), (d) => d.reload()],
  'card-data-in-the-payload': visit({ pay: 'card' }),
}

const PAGE_NAMES = { shop: 'Shop', product: 'Product', cart: 'Cart', checkout: 'Checkout', thanks: 'Thank-you' }

const demo = startDemo({ plugin: 'shopify', page: PAGE_NAMES[page], scenarios })

// ---- The platform doubles ----------------------------------------------------------------------

// The storefront global. Its Customer Privacy API is present only when the sandbox says so:
// `absent` is the pixel sandbox, where the Pixel Manager applied consent before the pixel ran.
const privacy = demo.platform.customerPrivacy ?? 'absent'
window.Shopify = { shop: 'northline-demo.myshopify.com', currency: { active: 'USD' }, locale: 'en-US' }
if (privacy !== 'absent') {
  window.Shopify.customerPrivacy = {
    analyticsProcessingAllowed: () => privacy === 'allowed',
    currentVisitorConsent: () => ({ analytics: privacy === 'allowed' ? 'yes' : 'no' }),
  }
}

/** The Web Pixel sandbox's `analytics` global: subscribe, and the Pixel Manager publishes. */
const subscribers = new Map()
const analytics = {
  subscribe(name, callback) {
    subscribers.set(name, [...(subscribers.get(name) ?? []), callback])
  },
}
let eventCount = 0
function publish(name, data) {
  eventCount += 1
  const event = { name, id: `evt-demo-${eventCount}`, timestamp: new Date().toISOString(), data }
  demo.as(name, () => {
    for (const callback of subscribers.get(name) ?? []) callback(event)
  }, { payload: event })
}

demo.init(window.DD_RUM_PLUGINS.shopify({ ...demo.options, analytics }), { source: 'analytics.init' })

// ---- Cart ---------------------------------------------------------------------------------------

const lines = () => demo.state('cart') ?? {}

function cartLine(sku, quantity) {
  const merchandise = CATALOGUE[sku]
  return { quantity, cost: { totalAmount: money(merchandise.price.amount * quantity) }, merchandise }
}

function cartLines(quantities = lines()) {
  return Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([sku, quantity]) => cartLine(sku, quantity))
}

const subtotal = (list = cartLines()) => list.reduce((sum, line) => sum + line.cost.totalAmount.amount, 0)

function cart() {
  const list = cartLines()
  return {
    id: 'gid://shopify/Cart/c1-8f2a',
    totalQuantity: list.reduce((sum, line) => sum + line.quantity, 0),
    cost: { totalAmount: money(subtotal(list)) },
    lines: list,
  }
}

/** The checkout, in the recorded shape, holding this visit's lines and choices. */
function checkout() {
  const list = cartLines()
  const ship = demo.state('ship') ?? 'Ground'
  const pay = demo.state('pay') ?? 'paypal'
  const base = subtotal(list)
  return {
    token: startedRecording.token,
    currencyCode: 'USD',
    subtotalPrice: money(base),
    totalTax: money(TAX),
    totalPrice: money(base + TAX + SHIPPING[ship]),
    discountApplications: startedRecording.discountApplications,
    shippingLine: { title: ship, price: money(SHIPPING[ship]) },
    delivery: { selectedDeliveryOptions: [{ title: ship }] },
    transactions: [{ gateway: 'shopify_payments', paymentMethod: pay === 'card' ? 'credit_card' : 'paypal' }],
    lineItems: list.map((line, index) => ({ id: `li-${index + 1}`, title: line.merchandise.product.title, quantity: line.quantity, variant: line.merchandise })),
  }
}

function add(sku, quantity) {
  demo.state('cart', { ...lines(), [sku]: (lines()[sku] ?? 0) + quantity })
  publish('product_added_to_cart', { cartLine: cartLine(sku, quantity) })
  paintCount()
}

function paintCount() {
  const count = Object.values(lines()).reduce((sum, quantity) => sum + quantity, 0)
  for (const element of document.querySelectorAll('[data-cart-count]')) element.textContent = String(count)
}

document.querySelector('[data-search]')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') publish('search_submitted', { searchResult: { query: event.currentTarget.value } })
})

// ---- Pages --------------------------------------------------------------------------------------

if (page === 'shop') {
  document.querySelector('[data-collection-title]').textContent = collection.title
  const grid = document.querySelector('[data-grid]')
  for (const variant of Object.values(CATALOGUE)) {
    const card = document.createElement('article')
    card.className = 'card'
    const title = variant.sku === TEE ? `<a href="product.html" data-product="${TEE}">${variant.product.title}</a>` : variant.product.title
    card.innerHTML = `<div class="ph">product shot</div><h2>${title}</h2><p class="price">${dollars(variant.price.amount)}</p>
      <button type="button" data-add="${variant.sku}">Quick add</button>`
    card.querySelector('button').addEventListener('click', () => add(variant.sku, 1))
    grid.append(card)
  }
  publish('collection_viewed', { collection })
}

if (page === 'product') {
  document.querySelector('[data-product-name]').textContent = viewed.product.title
  document.querySelector('[data-product-price]').textContent = dollars(viewed.price.amount)
  document.querySelector('[data-product-variant]').textContent = viewed.title
  const output = document.querySelector('[data-qty]')
  const quantity = () => Number(output.textContent)
  document.querySelector('[data-qty-up]').addEventListener('click', () => { output.textContent = String(quantity() + 1) })
  document.querySelector('[data-qty-down]').addEventListener('click', () => { output.textContent = String(Math.max(1, quantity() - 1)) })
  document.querySelector('[data-add-to-cart]').addEventListener('click', () => add(TEE, quantity()))
  publish('product_viewed', { productVariant: viewed })
}

if (page === 'cart') {
  const paint = () => {
    const list = document.querySelector('[data-lines]')
    list.replaceChildren()
    const current = cartLines()
    if (current.length === 0) list.innerHTML = '<p class="muted">Your cart is empty. <a href="index.html">Back to the sale</a></p>'
    for (const line of current) {
      const row = document.createElement('div')
      row.className = 'line'
      const variant = line.merchandise.title === 'Default Title' ? line.merchandise.product.type : line.merchandise.title
      row.innerHTML = `<div class="ph">item</div><div><strong>${line.merchandise.product.title}</strong><span class="muted">${variant} · qty ${line.quantity}</span></div>
        <span>${dollars(line.cost.totalAmount.amount)}</span><button type="button" data-remove="${line.merchandise.sku}">Remove</button>`
      row.querySelector('button').addEventListener('click', () => {
        demo.state('cart', { ...lines(), [line.merchandise.sku]: 0 })
        publish('product_removed_from_cart', { cartLine: line })
        paint()
        paintCount()
      })
      list.append(row)
    }
    document.querySelector('[data-subtotal]').textContent = dollars(subtotal())
  }
  paint()
  publish('cart_viewed', { cart: cart() })
}

if (page === 'checkout') {
  const paint = () => {
    const current = checkout()
    const rows = current.lineItems.map((item) => `<p>${item.title} × ${item.quantity} <span>${dollars(item.variant.price.amount * item.quantity)}</span></p>`)
    document.querySelector('[data-order-summary]').innerHTML = `${rows.join('')}
      <p>Discount ${current.discountApplications[0].title} <span>applied</span></p><p>Shipping <span>${dollars(current.shippingLine.price.amount)}</span></p>
      <p>Tax <span>${dollars(TAX)}</span></p><p class="total">Total <span>${dollars(current.totalPrice.amount)}</span></p>`
  }
  for (const input of document.querySelectorAll('[data-ship]')) {
    input.addEventListener('change', () => {
      demo.state('ship', input.value)
      paint()
      publish('checkout_shipping_info_submitted', { checkout: checkout() })
    })
  }
  for (const input of document.querySelectorAll('[data-pay]')) {
    input.addEventListener('change', () => {
      demo.state('pay', input.value)
      document.querySelector('[data-card]').hidden = input.value !== 'card'
      const payload = checkout()
      // The recording carries card data in the payment event; so does a card payment here.
      if (input.value === 'card') Object.assign(payload, { card_number: paymentRecording.card_number, cvv: paymentRecording.cvv })
      publish('payment_info_submitted', { checkout: payload })
    })
  }
  paint()
  publish('checkout_started', { checkout: checkout() })
}

if (page === 'thanks') {
  // A reload republishes checkout_completed for the same order, as the second recording shows.
  const again = demo.state('ordered') === true
  const order = again
    ? completedAgain
    : { ...checkout(), order: completed.order, email: completed.email }
  demo.state('ordered', true)
  demo.state('cart', {})
  document.querySelector('[data-order]').innerHTML = `<div><dt>Order</dt><dd>#1001</dd></div>
    <div><dt>Total</dt><dd>${dollars(order.totalPrice.amount)}</dd></div>
    <div><dt>Payment</dt><dd>${(demo.state('pay') ?? 'paypal') === 'card' ? 'Card' : 'PayPal'}</dd></div>`
  publish('checkout_completed', { checkout: order })
  document.querySelector('[data-reload]').addEventListener('click', () => demo.reload())
}

paintCount()
demo.ready()

// ---- Scenarios ----------------------------------------------------------------------------------

/** One visit through the store, driving the real buttons and links. */
function visit({ pay }) {
  return [
    (d) => d.type('[data-search]', 'red tee medium'),
    (d) => d.press('[data-search]', 'Enter'),
    (d) => d.click(`[data-add="${CAP}"]`),
    (d) => d.follow(`[data-product="${TEE}"]`),
    (d) => d.click('[data-add-to-cart]'),
    (d) => d.follow('[data-cart-link]'),
    (d) => d.click(`[data-remove="${CAP}"]`),
    (d) => d.follow('[data-checkout]'),
    (d) => d.click('[data-ship="Ground"]'),
    (d) => d.click(`[data-pay="${pay}"]`),
    (d) => d.follow('[data-place-order]'),
  ]
}

/** Which interaction reaches each action the plugin declares; checked by `npm run lint:demos`. */
export const coverage = {
  reachable: {
    'commerce.view_item_list': 'the sale collection loads',
    'commerce.view_item': 'the product page loads',
    'commerce.add_to_cart': 'Quick add, or Add to cart on the product page',
    'commerce.remove_from_cart': 'Remove, on the cart page',
    'commerce.view_cart': 'the cart page loads',
    'commerce.begin_checkout': 'the checkout page loads',
    'commerce.add_shipping_info': 'choosing a shipping method',
    'commerce.add_payment_info': 'choosing a payment method',
    'commerce.purchase': 'the thank-you page loads',
    'commerce.search': 'Enter in the product search',
  },
}
