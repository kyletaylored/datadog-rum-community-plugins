import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  checkConformance,
  createFakeRum,
  formatFindings,
  installMemoryLocalStorage,
  loadFixtures,
  writeEventReport,
  type Fixture,
} from '../../test-harness/src/index.js'
import type { PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { WOO_EVENTS, wooCommercePlugin } from '../src/index.js'
import { wooMoney } from '../src/mapping.js'
import type { WooGlobalPayload } from '../src/types.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../plugin.json', import.meta.url)), 'utf8'),
) as PluginManifest

let restoreStorage: () => void
// Fresh storage per test: the purchase dedupe is shared state, and a leftover entry from an
// earlier test would look exactly like working deduplication.
beforeEach(() => {
  restoreStorage = installMemoryLocalStorage()
})
afterEach(() => restoreStorage())

const allFixtures = loadFixtures(fixturesDir).flatMap((entry) => entry.fixtures)
const orderFixture = allFixtures.find((fixture) => fixture.event === 'order_received')!
const cartFixtures = allFixtures.filter((fixture) => fixture.event !== 'order_received')

/** Woo dispatches its block events on an element; the adapter listens there, so the test does too. */
function emitTo(target: EventTarget, fixture: Fixture) {
  target.dispatchEvent(new CustomEvent(fixture.event, { detail: fixture.payload }))
}

async function run(options: Parameters<typeof wooCommercePlugin>[0] = {}) {
  const rum = createFakeRum({})
  const target = new EventTarget()
  const plugin = wooCommercePlugin({
    consent: 'ignore',
    data: orderFixture.payload as WooGlobalPayload,
    target,
    ...options,
  })
  await plugin.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
  for (const fixture of cartFixtures) emitTo(target, fixture)
  return { rum, target }
}

describe('money', () => {
  it('reads Woo minor units with the exponent the Store API sends', () => {
    expect(wooMoney('2499', 2)).toBe(24.99)
    expect(wooMoney('8450', 2)).toBe(84.5)
  })

  it('reads a decimal string when no exponent is given, as classic themes send', () => {
    expect(wooMoney('24.99')).toBe(24.99)
  })

  it('returns undefined for an empty or unparseable value', () => {
    expect(wooMoney('', 2)).toBeUndefined()
    expect(wooMoney('abc', 2)).toBeUndefined()
  })
})

describe('order-received page', () => {
  it('fires purchase from the server-rendered payload', async () => {
    const { rum } = await run()
    const purchase = rum.actions().find((action) => action.name === 'commerce.purchase')
    expect(purchase?.context).toEqual({
      transaction_id: 'wc_1042',
      value: 100.6,
      currency: 'USD',
      tax: 6.2,
      shipping: 4.95,
      coupon: 'WELCOME10',
      payment_type: 'paypal',
      shipping_tier: 'Ground',
      item_count: 3,
      unique_items: 2,
    })
  })

  it('strips the card number and billing address the payload carried', async () => {
    const { rum } = await run()
    expect(JSON.stringify(rum.calls)).not.toContain('4242')
    expect(JSON.stringify(rum.calls)).not.toContain('Market St')
  })

  it('sets the store context and the customer type', async () => {
    const { rum } = await run()
    expect(rum.globalContext()).toMatchObject({
      'store.id': 'shop.example.com',
      'store.currency': 'USD',
      'store.locale': 'en-US',
      'customer.type': 'returning',
      'commerce.platform': 'woocommerce',
    })
  })

  it('identifies by WordPress user ID only, with no email by default', async () => {
    const { rum } = await run()
    expect(rum.calls).toContainEqual({ api: 'setUser', user: { id: '42' } })
  })

  it('does not fire purchase twice if the thank-you page is reloaded', async () => {
    const { rum, target } = await run()
    // A reload is a second plugin init reading the same payload.
    const second = wooCommercePlugin({ consent: 'ignore', data: orderFixture.payload as WooGlobalPayload, target })
    await second.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(rum.actions().filter((action) => action.name === 'commerce.purchase')).toHaveLength(1)
  })

  it('skips purchase when the payload has no transaction_id', async () => {
    const rum = createFakeRum({})
    await wooCommercePlugin({
      consent: 'ignore',
      target: new EventTarget(),
      data: { order: { value: 10, currency: 'USD' } as never },
    }).onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(rum.actions()).toHaveLength(0)
  })
})

describe('storefront cart events', () => {
  it('maps the recorded block events to the schema', async () => {
    const { rum } = await run()
    expect(rum.actions().map((action) => action.name)).toEqual([
      'commerce.purchase',
      'commerce.add_to_cart',
      'commerce.remove_from_cart',
      'commerce.add_to_cart',
    ])
  })

  it('reports the value of the line that changed, not the whole cart', async () => {
    const { rum } = await run()
    const added = rum.actions().filter((action) => action.name === 'commerce.add_to_cart')
    // Two tees at 28.00 is the line that changed; the cart total is 84.50.
    expect(added[0]?.context.value).toBe(56)
    expect(added[0]?.context.cart_id).toBe('c1-8f2a')
  })

  it('matches the committed snapshot for every mapped action', async () => {
    const { rum } = await run({ includeItems: true })
    expect(rum.actions()).toMatchSnapshot()
    // The site's "Events this plugin sends" is generated here, from this same run.
    writeEventReport(packageDir, 'woocommerce', rum)
  })

  it('covers classic themes through the jQuery added_to_cart event', async () => {
    const { rum } = await run()
    const classic = rum.actions().filter((action) => action.name === 'commerce.add_to_cart')
    expect(classic[1]?.context.value).toBe(12)
  })

  it('listens on every event the manifest declares', async () => {
    expect([...WOO_EVENTS].sort()).toEqual([...manifest.footprint.events].sort())
  })
})

describe('checkout reporter', () => {
  it('reports the funnel steps the DOM events do not cover', async () => {
    const { rum } = await run()
    const cart = (cartFixtures[0]!.payload as { cart: Record<string, unknown> }).cart
    const { createCheckoutReporter } = await import('../src/index.js')
    const { createTracker, COMMERCE_FAMILY } = await import('@kyletaylored/datadog-rum-community-plugins')
    const tracker = createTracker({
      platform: 'woocommerce',
      version: '0.1.0',
      publicApi: rum.publicApi,
      families: [COMMERCE_FAMILY],
      options: { consent: 'ignore' },
      footprint: { globals: [], events: [], rumApis: [], consentSource: null },
    })
    const reporter = createCheckoutReporter(tracker)
    rum.reset()

    reporter.viewCart(cart as never)
    reporter.beginCheckout(cart as never)
    reporter.addShippingInfo(cart as never, 'Ground')
    reporter.addPaymentInfo(cart as never, 'paypal')
    reporter.search('red tee medium')

    expect(rum.actions().map((action) => action.name)).toEqual([
      'commerce.view_cart',
      'commerce.begin_checkout',
      'commerce.add_shipping_info',
      'commerce.add_payment_info',
      'commerce.search',
    ])
    expect(rum.actions()[4]?.context).toEqual({ search_term_length: 14 })
  })
})

describe('consent', () => {
  it('sends nothing until consent is granted, and holds RUM itself in onInit', async () => {
    const rum = createFakeRum({})
    const target = new EventTarget()
    await wooCommercePlugin({ data: orderFixture.payload as WooGlobalPayload, target }).onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    for (const fixture of cartFixtures) emitTo(target, fixture)

    expect(rum.initConfiguration.trackingConsent).toBe('not-granted')
    expect(rum.actions()).toHaveLength(0)
    expect(rum.calls.some((call) => call.api === 'setUser')).toBe(false)
  })
})

describe('conformance', () => {
  it('passes the shared suite with default options', async () => {
    const { rum } = await run()
    expect(formatFindings(checkConformance({ manifest, rum }))).toBe('conformance: ok')
  })

  it('passes with items and PII opted in', async () => {
    const { rum } = await run({ includeItems: true, includeEmail: true, includeName: true })
    const result = checkConformance({
      manifest,
      rum,
      options: { includeItems: true, includeEmail: true, includeName: true },
    })
    expect(formatFindings(result)).toBe('conformance: ok')
  })
})
