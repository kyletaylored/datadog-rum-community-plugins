/**
 * Northline, the Shopify demo store.
 *
 * Every step publishes a Shopify Web Pixels standard event on an `analytics` double, the object a
 * custom pixel receives, and the plugin subscribes to it exactly as it does in a real pixel.
 * Payloads take their shape, and where the visit matches the recording their values, from the
 * plugin's fixtures — card number and CVV included on a card payment, as the fixture records them.
 * Product photos are the variants' `image.src`, which Web Pixels payloads carry; no plugin sends them.
 */
import { startDemo } from '../_shared/bridge.js'

const fixtures = window.DDRumDemoFixtures.shopify
const page = document.body.dataset.page

// ---- Catalog, from the fixtures ---------------------------------------------------------------

const collection = fixtures['collection viewed'].payload.data.collection
const viewed = fixtures['product viewed'].payload.data.productVariant
const paymentRecording = fixtures['payment info submitted, with card data in the payload'].payload.data.checkout
const completed = fixtures['checkout completed'].payload.data.checkout
const completedAgain = fixtures['checkout completed again, same order'].payload.data.checkout
const startedRecording = fixtures['checkout started'].payload.data.checkout

/** Product variants by SKU. The laptop is the richer `product viewed` variant, with its IDs. */
const CATALOGUE = Object.fromEntries(
  collection.productVariants.map((variant) => [variant.sku, variant.sku === viewed.sku ? viewed : variant]),
)
const LAPTOP = viewed.sku
/** The line the recording removes from the cart: the phone. */
const PHONE = fixtures['product removed from cart'].payload.data.cartLine.merchandise.sku

/**
 * The laptop's other variants, which no fixture records. Kept in the Web Pixels ProductVariant
 * shape, next to the fixture data, so they are easy to replace with recordings: each has its own
 * ID, SKU, title and price, with the fixture's Silver / 512 GB as the default the scenarios add.
 */
const COLORS = [['Silver', 'SLV'], ['Space Gray', 'GRY']]
const STORAGE = [['256 GB', '256', -200], ['512 GB', '512', 0]]
const VARIANTS = Object.fromEntries(
  COLORS.flatMap(([color, colorCode], colorIndex) =>
    STORAGE.map(([storage, storageCode, priceDelta], storageIndex) => {
      const title = `${color} / ${storage}`
      const variant = title === viewed.title ? viewed : {
        ...viewed,
        id: `${viewed.id}${colorIndex * 2 + storageIndex}`,
        sku: `LAP-14-${colorCode}-${storageCode}`,
        title,
        price: money(viewed.price.amount + priceDelta),
      }
      return [title, variant]
    }),
  ),
)
for (const variant of Object.values(VARIANTS)) CATALOGUE[variant.sku] = variant
/** The fixtures' tax rate: the recorded checkout's tax is 8% of its subtotal. */
const TAX_RATE = startedRecording.totalTax.amount / startedRecording.subtotalPrice.amount
const SHIPPING = { Ground: 4.95, Express: 14 }
function money(amount) {
  return { amount: Math.round(amount * 100) / 100, currencyCode: 'USD' }
}
const dollars = (amount) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A product photo, from the image the variant carries. */
function photo(variant, className, size = 800) {
  const image = document.createElement('img')
  image.src = variant.image?.src
  image.alt = variant.product.title
  image.width = size
  image.height = size === 800 ? 600 : size
  image.loading = 'lazy'
  image.className = className
  return image
}

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
  const tax = Math.round(base * TAX_RATE * 100) / 100
  return {
    token: startedRecording.token,
    currencyCode: 'USD',
    subtotalPrice: money(base),
    totalTax: money(tax),
    totalPrice: money(base + tax + SHIPPING[ship]),
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
  for (const listed of collection.productVariants) {
    const variant = CATALOGUE[listed.sku]
    const card = document.createElement('article')
    card.className = 'product-card'
    const isLaptop = variant.sku === LAPTOP
    const from = Math.min(...Object.values(VARIANTS).map((option) => option.price.amount))
    card.innerHTML = `<h2></h2><p class="meta"></p><p class="price">${isLaptop ? `From ${dollars(from)}` : dollars(variant.price.amount)}</p>
      <button type="button" data-add="${variant.sku}">${isLaptop ? 'Choose options' : 'Quick add'}</button>`
    card.prepend(photo(variant, 'product-photo'))
    card.querySelector('h2').textContent = variant.product.title
    card.querySelector('.meta').textContent = variant.product.type
    const button = card.querySelector('button')
    if (isLaptop) {
      // A product with options has no quick add: the shopper picks a color and storage first.
      const link = document.createElement('a')
      link.href = 'product.html'
      link.dataset.product = variant.sku
      link.className = 'card-link'
      link.setAttribute('aria-label', variant.product.title)
      card.append(link)
      button.addEventListener('click', () => link.click())
    } else {
      button.addEventListener('click', () => add(variant.sku, 1))
    }
    grid.append(card)
  }
  publish('collection_viewed', { collection })
}

if (page === 'product') {
  document.querySelector('[data-product-photo]').replaceWith(photo(viewed, 'product-photo large'))
  document.querySelector('[data-product-name]').textContent = viewed.product.title
  const colorSelect = document.querySelector('[data-option="Color"]')
  const storageSelect = document.querySelector('[data-option="Storage"]')
  const [defaultColor, defaultStorage] = viewed.title.split(' / ')
  for (const [color] of COLORS) colorSelect.add(new Option(color, color, color === defaultColor, color === defaultColor))
  for (const [storage] of STORAGE) storageSelect.add(new Option(storage, storage, storage === defaultStorage, storage === defaultStorage))
  const chosen = () => VARIANTS[`${colorSelect.value} / ${storageSelect.value}`]
  const paint = () => {
    document.querySelector('[data-product-price]').textContent = dollars(chosen().price.amount)
    document.querySelector('[data-product-sku]').textContent = `SKU ${chosen().sku}`
  }
  colorSelect.addEventListener('change', paint)
  storageSelect.addEventListener('change', paint)
  paint()
  const output = document.querySelector('[data-qty]')
  const quantity = () => Number(output.textContent)
  document.querySelector('[data-qty-up]').addEventListener('click', () => { output.textContent = String(quantity() + 1) })
  document.querySelector('[data-qty-down]').addEventListener('click', () => { output.textContent = String(Math.max(1, quantity() - 1)) })
  document.querySelector('[data-add-to-cart]').addEventListener('click', () => add(chosen().sku, quantity()))
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
      row.innerHTML = `<div><strong>${line.merchandise.product.title}</strong><span class="muted">${variant} · qty ${line.quantity}</span></div>
        <span>${dollars(line.cost.totalAmount.amount)}</span><button type="button" data-remove="${line.merchandise.sku}">Remove</button>`
      row.prepend(photo(line.merchandise, 'line-photo', 300))
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
      <p>Tax <span>${dollars(current.totalTax.amount)}</span></p><p class="total">Total <span>${dollars(current.totalPrice.amount)}</span></p>`
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
    (d) => d.type('[data-search]', 'silver laptop'),
    (d) => d.press('[data-search]', 'Enter'),
    (d) => d.click(`[data-add="${PHONE}"]`),
    (d) => d.follow(`[data-product="${LAPTOP}"]`),
    (d) => d.click('[data-add-to-cart]'),
    (d) => d.follow('[data-cart-link]'),
    (d) => d.click(`[data-remove="${PHONE}"]`),
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
