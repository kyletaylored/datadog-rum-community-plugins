import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  checkConformance,
  createFakeRum,
  formatFindings,
  loadFixtures,
  recordJourney,
  writeEventReport,
  type Fixture,
} from '../../test-harness/src/index.js'
import type { PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { shopifyPlugin } from '../src/index.js'
import type { ShopifyAnalyticsApi, ShopifyEvent } from '../src/types.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../plugin.json', import.meta.url)), 'utf8'),
) as PluginManifest

/** A stand-in for the Web Pixel sandbox `analytics` global, so the adapter's own subscribe runs. */
function fakeAnalytics() {
  const handlers = new Map<string, ((event: ShopifyEvent) => void)[]>()
  const api: ShopifyAnalyticsApi = {
    subscribe(event, callback) {
      const list = handlers.get(event) ?? []
      list.push(callback)
      handlers.set(event, list)
    },
  }
  return {
    api,
    emit(fixture: Fixture) {
      for (const handler of handlers.get(fixture.event) ?? []) {
        handler(fixture.payload as ShopifyEvent)
      }
    },
    subscribedEvents: () => [...handlers.keys()],
  }
}

async function run(options: Parameters<typeof shopifyPlugin>[0] = {}) {
  const rum = createFakeRum({})
  const analytics = fakeAnalytics()
  const plugin = shopifyPlugin({ analytics: analytics.api, consent: 'ignore', ...options })
  const outcome = await plugin.onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })

  const fixtures = loadFixtures(fixturesDir).flatMap((entry) => entry.fixtures)
  for (const fixture of fixtures) analytics.emit(fixture)

  return { rum, analytics, outcome, fixtures }
}

/** The manifest's journey, replayed for the plugin page. */
function journey() {
  const options = { consent: 'ignore' as const }
  return recordJourney({
    platform: 'shopify',
    journey: manifest.journey,
    fixtures: loadFixtures(fixturesDir).flatMap((entry) => entry.fixtures),
    options,
    start: async ({ publicApi, initConfiguration }) => {
      const analytics = fakeAnalytics()
      await shopifyPlugin({ ...options, debug: true, analytics: analytics.api }).onInit?.({ initConfiguration, publicApi })
      return (fixture) => analytics.emit(fixture)
    },
  })
}

describe('composition with the official plugin', () => {
  it('leaves initConfiguration alone, since the official plugin owns it', async () => {
    const rum = createFakeRum({ trackViewsManually: false, sessionReplaySampleRate: 100 })
    const analytics = fakeAnalytics()
    await shopifyPlugin({ analytics: analytics.api, consent: 'ignore' }).onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    expect(rum.initConfiguration).toEqual({ trackViewsManually: false, sessionReplaySampleRate: 100 })
  })

  it('does not subscribe to the events the official plugin already binds', async () => {
    const { analytics } = await run()
    expect(analytics.subscribedEvents()).not.toContain('page_viewed')
    expect(analytics.subscribedEvents()).not.toContain('clicked')
    expect(analytics.subscribedEvents()).not.toContain('ui_extension_errored')
  })

  it('opts out when no analytics global was passed, rather than looking healthy', async () => {
    const rum = createFakeRum({})
    const outcome = await shopifyPlugin({}).onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    expect(outcome).toBe(false)
  })
})

describe('event mapping', () => {
  it('maps the recorded checkout funnel to the schema, in order', async () => {
    const { rum } = await run()
    expect(rum.actions().map((action) => action.name)).toEqual([
      'commerce.view_item',
      'commerce.add_to_cart',
      'commerce.view_cart',
      'commerce.begin_checkout',
      'commerce.add_shipping_info',
      'commerce.add_payment_info',
      'commerce.purchase',
      'commerce.search',
      'commerce.view_item_list',
      'commerce.remove_from_cart',
    ])
  })

  it('matches the committed snapshot for every mapped action', async () => {
    const { rum } = await run({ includeItems: true })
    expect(rum.actions()).toMatchSnapshot()
    // The site's "Events this plugin sends" is generated here, from this same run.
    writeEventReport(packageDir, 'shopify', rum, await journey())
  })

  it('reports order value, tax, shipping and coupon on purchase', async () => {
    const { rum } = await run()
    const purchase = rum.actions().find((action) => action.name === 'commerce.purchase')
    expect(purchase?.context).toEqual({
      transaction_id: '5512345678901',
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

  it('identifies the customer before the purchase action lands', async () => {
    const { rum } = await run()
    const setUserAt = rum.calls.findIndex((call) => call.api === 'setUser')
    const purchaseAt = rum.calls.findIndex((call) => call.api === 'addAction' && call.name === 'commerce.purchase')
    expect(setUserAt).toBeGreaterThan(-1)
    expect(setUserAt).toBeLessThan(purchaseAt)
    expect(rum.calls[setUserAt]).toEqual({ api: 'setUser', user: { id: '6612345678' } })
  })

  it('fires purchase once even though the fixture replays checkout_completed', async () => {
    const { rum, fixtures } = await run()
    expect(fixtures.filter((f) => f.event === 'checkout_completed')).toHaveLength(2)
    expect(rum.actions().filter((action) => action.name === 'commerce.purchase')).toHaveLength(1)
  })

  it('sends the search term length, never the term', async () => {
    const { rum } = await run()
    const search = rum.actions().find((action) => action.name === 'commerce.search')
    expect(search?.context).toEqual({ search_term_length: 14 })
  })

  it('strips card data that a payload carries, down to the payment method name', async () => {
    const { rum } = await run()
    const payment = rum.actions().find((action) => action.name === 'commerce.add_payment_info')
    expect(payment?.context).toEqual({ value: 100.6, currency: 'USD', payment_type: 'paypal' })
    expect(JSON.stringify(rum.calls)).not.toContain('4242')
  })

  it('drops the Default Title placeholder rather than sending it as a variant', async () => {
    const { rum } = await run({ includeItems: true })
    const items = rum.actions().flatMap((action) => (action.context.items as Record<string, unknown>[] | undefined) ?? [])
    expect(items.some((item) => item.item_variant === 'Default Title')).toBe(false)
    expect(items.some((item) => item.item_variant === 'Red / M')).toBe(true)
  })
})

describe('consent', () => {
  it('sends nothing while the Customer Privacy API says analytics is not allowed', async () => {
    ;(globalThis as Record<string, unknown>).Shopify = {
      shop: 'acme.myshopify.com',
      currency: { active: 'USD' },
      customerPrivacy: { analyticsProcessingAllowed: () => false },
    }
    try {
      const rum = createFakeRum({})
      const analytics = fakeAnalytics()
      await shopifyPlugin({ analytics: analytics.api }).onInit?.({
        initConfiguration: rum.initConfiguration,
        publicApi: rum.publicApi,
      })
      for (const fixture of loadFixtures(fixturesDir).flatMap((entry) => entry.fixtures)) analytics.emit(fixture)
      expect(rum.actions()).toHaveLength(0)
    } finally {
      delete (globalThis as Record<string, unknown>).Shopify
    }
  })
})

describe('conformance', () => {
  it('passes the shared suite with default options', async () => {
    const { rum } = await run()
    const result = checkConformance({ manifest, rum })
    expect(formatFindings(result)).toBe('conformance: ok')
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

  it('passes with a renamed commerce prefix', async () => {
    const { rum } = await run({ actionPrefix: 'shop.' })
    const result = checkConformance({ manifest, rum, options: { actionPrefix: 'shop.' } })
    expect(formatFindings(result)).toBe('conformance: ok')
  })

  it('declares a footprint that matches what the run actually did', async () => {
    const { rum } = await run()
    for (const api of rum.apisUsed()) {
      expect(manifest.footprint.rumApis, `plugin.json must declare ${api}`).toContain(api)
    }
  })
})
