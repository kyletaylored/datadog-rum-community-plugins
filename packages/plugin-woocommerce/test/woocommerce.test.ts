import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  checkConformance,
  createFakeRum,
  formatFindings,
  installMemoryLocalStorage,
  loadFixtures,
  recordJourney,
  writeEventReport,
  type Fixture,
} from '../../test-harness/src/index.js'
import { blockedKeys, type PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { WOO_EVENTS, createCheckoutReporter, wooCommercePlugin } from '../src/index.js'
import { wooMoney } from '../src/mapping.js'
import type { WooCart, WooGlobalPayload } from '../src/types.js'

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

/**
 * A classic theme's jQuery: `$(element).on(types, handler)` and `.trigger(type, args)`. Like real
 * jQuery, a trigger reaches only jQuery handlers, never a native addEventListener, which is
 * exactly the gap the plugin's jQuery listener closes.
 */
function fakeJQuery() {
  const handlers = new Map<EventTarget, Map<string, ((event: { type: string }, ...args: unknown[]) => void)[]>>()
  const $ = (element: EventTarget) => ({
    on(types: string, handler: (event: { type: string }, ...args: unknown[]) => void) {
      const byType = handlers.get(element) ?? new Map()
      for (const type of types.split(' ')) byType.set(type, [...(byType.get(type) ?? []), handler])
      handlers.set(element, byType)
      return this
    },
    trigger(type: string, args: unknown[] = []) {
      for (const handler of handlers.get(element)?.get(type) ?? []) handler({ type }, ...args)
      return this
    },
  })
  return $
}

/** classic-jquery.json's events are jQuery-only; their `event` is the jQuery event, prefixed `jquery:`. */
const JQUERY = 'jquery:'
type JQueryCall = { fragments: unknown; cart_hash: string; button: Record<string, string> }

function triggerThroughJQuery(target: EventTarget, fixture: Fixture) {
  const { fragments, cart_hash: cartHash, button } = fixture.payload as JQueryCall
  const $ = (globalThis as { jQuery?: ReturnType<typeof fakeJQuery> }).jQuery
  // Woo passes the add-to-cart link as a jQuery object.
  $?.(target).trigger(fixture.event.slice(JQUERY.length), [fragments, cartHash, { attr: (name: string) => button[name] }])
}

// The plugin looks for window.jQuery at init, as on a classic theme. Fresh per test.
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).jQuery = fakeJQuery()
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).jQuery
})

/** checkout.json's steps have no DOM event; their `event` names the reporter method to call. */
const REPORTER = 'createCheckoutReporter.'
type ReporterCall = { cart?: WooCart; shippingTier?: string; paymentType?: string; term?: string }

/**
 * Hand one fixture to the plugin the way the platform would: a DOM event on the target, or, for a
 * funnel step, a call on the plugin's checkout reporter, built from the instance as the CDN exposes it.
 */
function replay(target: EventTarget, reporter: ReturnType<typeof createCheckoutReporter>, fixture: Fixture) {
  if (fixture.event.startsWith(JQUERY)) return triggerThroughJQuery(target, fixture)
  if (!fixture.event.startsWith(REPORTER)) return emitTo(target, fixture)
  const call = fixture.payload as ReporterCall
  switch (fixture.event.slice(REPORTER.length)) {
    case 'viewCart': return reporter.viewCart(call.cart!)
    case 'beginCheckout': return reporter.beginCheckout(call.cart!)
    case 'addShippingInfo': return reporter.addShippingInfo(call.cart!, call.shippingTier)
    case 'addPaymentInfo': return reporter.addPaymentInfo(call.cart!, call.paymentType)
    case 'search': return reporter.search(call.term ?? '')
    default: throw new Error(`no reporter method for fixture "${fixture.name}" (${fixture.event})`)
  }
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
  const reporter = createCheckoutReporter(plugin)
  for (const fixture of cartFixtures) replay(target, reporter, fixture)
  return { rum, target }
}

/**
 * The manifest's journey, replayed for the plugin page. Store and customer are printed on every
 * page by the WordPress plugin, so they are there at init; the order only on the thank-you page,
 * which is why "order received" is a fresh adapter reading the full payload, as a reload is.
 */
function journey() {
  const page = orderFixture.payload as WooGlobalPayload
  const options = { consent: 'ignore' as const }
  return recordJourney({
    platform: 'woocommerce',
    journey: manifest.journey,
    fixtures: allFixtures,
    options,
    start: async ({ publicApi, initConfiguration }) => {
      const target = new EventTarget()
      const everyPage = { store: page.store, customer: page.customer }
      const plugin = wooCommercePlugin({ ...options, debug: true, target, data: everyPage })
      await plugin.onInit?.({ initConfiguration, publicApi })
      const reporter = createCheckoutReporter(plugin)
      return async (fixture) => {
        if (fixture.event === 'order_received') {
          const reloaded = wooCommercePlugin({ ...options, debug: true, target, data: fixture.payload as WooGlobalPayload })
          await reloaded.onInit?.({ initConfiguration, publicApi })
          return
        }
        replay(target, reporter, fixture)
      }
    },
    // Only the order's own keys: the customer's email is identity, held back by includeEmail.
    strippedFor: (fixture) => blockedKeys((fixture.payload as WooGlobalPayload).order),
  })
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
  it('maps the recorded block events and checkout steps to the schema', async () => {
    const { rum } = await run()
    expect(rum.actions().map((action) => action.name)).toEqual([
      'commerce.purchase',
      'commerce.add_to_cart',
      'commerce.remove_from_cart',
      'commerce.add_to_cart',
      // checkout.json, through the checkout reporter
      'commerce.view_cart',
      'commerce.begin_checkout',
      'commerce.add_shipping_info',
      'commerce.add_payment_info',
      'commerce.search',
      // classic-jquery.json, through jQuery
      'commerce.add_to_cart',
      'commerce.remove_from_cart',
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
    writeEventReport(packageDir, 'woocommerce', rum, await journey())
  })

  it('maps an added_to_cart dispatched as a native DOM event, with its cart', async () => {
    const { rum } = await run()
    const native = rum.actions().filter((action) => action.name === 'commerce.add_to_cart')
    expect(native[1]?.context.value).toBe(12)
  })

  it('hears a classic theme that raises added_to_cart only through jQuery', async () => {
    const rum = createFakeRum({})
    const target = new EventTarget()
    await wooCommercePlugin({ consent: 'ignore', target }).onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    const fixture = allFixtures.find((entry) => entry.name === 'added to cart on a classic theme, through jQuery')!
    triggerThroughJQuery(target, fixture)

    // The product comes from the button; the jQuery event carries no price, so none is sent.
    expect(rum.actions()).toEqual([
      {
        api: 'addAction',
        name: 'commerce.add_to_cart',
        context: { item_count: 1, unique_items: 1 },
      },
    ])
  })

  it('does not count a jQuery add twice when the block scripts re-dispatch it natively', async () => {
    const rum = createFakeRum({})
    const target = new EventTarget()
    await wooCommercePlugin({ consent: 'ignore', includeItems: true, target }).onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    triggerThroughJQuery(target, allFixtures.find((entry) => entry.name === 'added to cart on a classic theme, through jQuery')!)
    // What Woo's block scripts dispatch for a jQuery add: the native event, with no cart in it.
    target.dispatchEvent(new CustomEvent('wc-blocks_added_to_cart', { detail: { preserveCartData: true } }))

    const adds = rum.actions().filter((action) => action.name === 'commerce.add_to_cart')
    expect(adds).toHaveLength(1)
    expect(adds[0]?.context.items).toEqual([{ item_id: 'SOCK-WHT-L', quantity: 1 }])
  })

  it('still hears native events on a page without jQuery', async () => {
    delete (globalThis as Record<string, unknown>).jQuery
    const rum = createFakeRum({})
    const target = new EventTarget()
    await wooCommercePlugin({ consent: 'ignore', target }).onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    emitTo(target, cartFixtures[0]!)
    expect(rum.actions().map((action) => action.name)).toEqual(['commerce.add_to_cart'])
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

describe('checkout reporter from a plugin instance, as the CDN build exposes it', () => {
  it('reports through the instance once init has run, with the gate and filter applied', async () => {
    const { createCheckoutReporter } = await import('../src/index.js')
    const rum = createFakeRum({})
    const plugin = wooCommercePlugin({ consent: 'ignore', target: new EventTarget() })
    // Made before init, as a page script would be.
    const reporter = createCheckoutReporter(plugin)
    await plugin.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })

    reporter.addPaymentInfo((cartFixtures[0]!.payload as { cart: never }).cart, 'card')
    reporter.search('red tee medium')
    expect(rum.actions().map((action) => action.name)).toEqual(['commerce.add_payment_info', 'commerce.search'])
    expect(rum.actions()[1]?.context).toEqual({ search_term_length: 14 })
  })

  it('holds a step behind the consent gate like any other event', async () => {
    const { createCheckoutReporter } = await import('../src/index.js')
    const rum = createFakeRum({})
    const plugin = wooCommercePlugin({ target: new EventTarget() })
    await plugin.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    createCheckoutReporter(plugin).search('anything')
    expect(rum.actions()).toHaveLength(0)
  })

  it('drops a step reported before init, with a warning, rather than queueing it', async () => {
    const { createCheckoutReporter } = await import('../src/index.js')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rum = createFakeRum({})
    const plugin = wooCommercePlugin({ consent: 'ignore', target: new EventTarget() })
    createCheckoutReporter(plugin).search('too early')
    await plugin.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(rum.actions().filter((action) => action.name === 'commerce.search')).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has not been initialized'))
    warn.mockRestore()
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
