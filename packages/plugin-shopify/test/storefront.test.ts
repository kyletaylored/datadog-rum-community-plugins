import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { COMMERCE_FAMILY, createTracker, type PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { checkConformance, createFakeRum, createMemoryStorage, formatFindings, loadFixtures, type FakeRum } from '../../test-harness/src/index.js'
import { FOOTPRINT, shopifyPlugin } from '../src/index.js'
import { cartId, diffCarts, snapshotOf, startStorefront } from '../src/storefront.js'
import type { AjaxCart, StorefrontMeta } from '../src/types.js'

const fixtures = loadFixtures(fileURLToPath(new URL('../fixtures/storefront', import.meta.url))).flatMap((entry) => entry.fixtures)
const byName = (name: string) => fixtures.find((fixture) => fixture.name === name)!.payload as never
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../plugin.json', import.meta.url)), 'utf8')) as PluginManifest

const BEFORE: AjaxCart = byName('cart before the doll is added')
const AFTER: AjaxCart = byName('cart after the doll is added')
const REQUANTIFIED: AjaxCart = byName("cart after the car's quantity goes to 2 and the doll is removed")

/** What must never leave the browser, all present in the recorded cart.js. */
const SECRETS = ['shopper@example.com', '0123456789abcdef', 'ftkn_example', 'Leave at the back door', 'For Sam', 'marketing description']

const scope = globalThis as Record<string, unknown>

function page(meta: StorefrontMeta, search = '') {
  scope.ShopifyAnalytics = { meta }
  scope.Shopify = { shop: 'creations-mattel.myshopify.com', currency: { active: 'USD' }, routes: { root: '/' } }
  scope.location = { search } as Location
}

afterEach(() => {
  for (const key of ['ShopifyAnalytics', 'Shopify', 'location']) delete scope[key]
})

function tracker(rum: FakeRum) {
  return createTracker({ platform: 'shopify', version: '0.0.0', publicApi: rum.publicApi, families: [COMMERCE_FAMILY], footprint: FOOTPRINT })
}

/** A storefront whose cart.js answers with each cart in turn. */
function storefront(rum: FakeRum, carts: AjaxCart[], storage = createMemoryStorage()) {
  const queue = [...carts]
  return startStorefront(tracker(rum), { readCart: async () => queue.shift(), storage })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('cart diff', () => {
  it('drops the cart key, which is a credential, from the cart ID', () => {
    expect(cartId('cTokenExample123?key=0123456789abcdef0123456789abcdef')).toBe('cTokenExample123')
  })

  it('finds the added line from two snapshots, though neither response names it', () => {
    const { added, removed } = diffCarts(snapshotOf(BEFORE), snapshotOf(AFTER))
    expect(added.map(([line, quantity]) => [line.item.item_id, quantity])).toEqual([['JLH31', 1]])
    expect(removed).toEqual([])
  })

  it('reports a quantity change and a removed line in one comparison', () => {
    const { added, removed } = diffCarts(snapshotOf(AFTER), snapshotOf(REQUANTIFIED))
    expect(added.map(([line, quantity]) => [line.item.item_id, quantity])).toEqual([['JMG42', 1]])
    expect(removed.map(([line, quantity]) => [line.item.item_id, quantity])).toEqual([['JLH31', 1]])
  })
})

describe('storefront mode', () => {
  it('sends add_to_cart for the doll, in dollars, with the cart ID but not its key', async () => {
    page({ page: { pageType: 'product' } })
    const rum = createFakeRum({})
    const shop = storefront(rum, [BEFORE, AFTER])
    await settle() // the first page of the session reads a baseline
    await shop.refresh()

    const [action] = rum.actions().filter((call) => call.name === 'commerce.add_to_cart')
    expect(action?.context).toEqual({
      value: 150,
      currency: 'USD',
      item_count: 1,
      unique_items: 1,
      cart_id: 'cTokenExample123',
    })
  })

  it('sends remove_from_cart and add_to_cart when one change does both', async () => {
    page({ page: { pageType: 'product' } })
    const rum = createFakeRum({})
    const shop = storefront(rum, [AFTER, REQUANTIFIED])
    await settle()
    await shop.refresh()
    expect(rum.actions().map((call) => [call.name, call.context.value])).toEqual([
      ['commerce.add_to_cart', 45],
      ['commerce.remove_from_cart', 150],
    ])
  })

  it('keeps its baseline across page loads, so a change on the next page is still seen', async () => {
    const storage = createMemoryStorage()
    page({ page: { pageType: 'home' } })
    storefront(createFakeRum({}), [BEFORE], storage)
    await settle()

    const rum = createFakeRum({})
    const next = storefront(rum, [AFTER], storage)
    await next.refresh()
    expect(rum.actions().map((call) => call.name)).toEqual(['commerce.add_to_cart'])
  })

  it('sends nothing for a new cart, since a different token is not a change', async () => {
    page({ page: { pageType: 'home' } })
    const rum = createFakeRum({})
    const shop = storefront(rum, [BEFORE, { ...AFTER, token: 'aFreshCart?key=x' }])
    await settle()
    await shop.refresh()
    expect(rum.actions()).toHaveLength(0)
  })

  it('sends view_cart with the whole cart on the cart page', async () => {
    page({ page: { pageType: 'cart' } })
    const rum = createFakeRum({})
    storefront(rum, [AFTER])
    await settle()
    await settle()
    expect(rum.actions().map((call) => [call.name, call.context.value, call.context.item_count])).toEqual([['commerce.view_cart', 195, 2]])
  })

  it('reads view_item from ShopifyAnalytics.meta on a product page', () => {
    page(byName('product page'))
    const rum = createFakeRum({})
    startStorefront(tracker(rum), { readCart: async () => undefined, storage: null })
    expect(rum.actions()[0]).toMatchObject({ name: 'commerce.view_item', context: { value: 45, currency: 'USD' } })
  })

  it('reads view_item_list on a collection page', () => {
    page(byName('collection page'))
    const rum = createFakeRum({})
    startStorefront(tracker(rum), { readCart: async () => undefined, storage: null })
    expect(rum.actions()[0]?.name).toBe('commerce.view_item_list')
  })

  it('sends only the length of the search query', () => {
    page(byName('search results for barbie'), '?q=barbie&options%5Bprefix%5D=last')
    const rum = createFakeRum({})
    startStorefront(tracker(rum), { readCart: async () => undefined, storage: null })
    expect(rum.actions()[0]).toMatchObject({ name: 'commerce.search', context: { search_term_length: 6 } })
    expect(JSON.stringify(rum.calls)).not.toContain('barbie')
  })

  it('sends begin_checkout with the cart when the shopper clicks the checkout control, and not for other clicks', async () => {
    const doc = new EventTarget()
    scope.document = doc
    try {
      page({ page: { pageType: 'cart' } })
      const rum = createFakeRum({})
      storefront(rum, [AFTER])
      await settle()
      await settle()
      const click = (matches: boolean) => {
        const event = new Event('click')
        Object.defineProperty(event, 'target', { value: { closest: () => (matches ? {} : null) } })
        doc.dispatchEvent(event)
      }
      click(false)
      click(true)
      expect(rum.actions().map((call) => [call.name, call.context.value])).toEqual([
        ['commerce.view_cart', 195],
        ['commerce.begin_checkout', 195],
      ])
    } finally {
      delete scope.document
    }
  })

  it('identifies a signed-in customer by ID only', () => {
    page({ page: { pageType: 'home', customerId: 7311 } })
    const rum = createFakeRum({})
    startStorefront(tracker(rum), { readCart: async () => undefined, storage: null })
    expect(rum.calls).toContainEqual({ api: 'setUser', user: { id: '7311' } })
  })

  it('never sends the email, tokens, note, line properties or description cart.js carries', async () => {
    page({ page: { pageType: 'cart' } })
    const rum = createFakeRum({})
    const storage = createMemoryStorage()
    const shop = startStorefront(
      createTracker({ platform: 'shopify', version: '0.0.0', publicApi: rum.publicApi, families: [COMMERCE_FAMILY], footprint: FOOTPRINT, options: { includeItems: true } }),
      { readCart: (() => { const queue = [BEFORE, AFTER, REQUANTIFIED]; return async () => queue.shift() })(), storage },
    )
    await settle()
    await shop.refresh()
    await shop.refresh()
    const sent = JSON.stringify(rum.calls) + JSON.stringify(storage.getItem('dd_rum_shopify_cart'))
    expect(rum.actions().length).toBeGreaterThan(2)
    for (const secret of SECRETS) expect(sent, `must not contain ${secret}`).not.toContain(secret)
  })
})

describe('mode selection', () => {
  it('runs storefront mode when no analytics was passed and the theme prints ShopifyAnalytics', async () => {
    page(byName('product page'))
    const rum = createFakeRum({})
    const outcome = await shopifyPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(outcome).not.toBe(false)
    expect(rum.actions().map((call) => call.name)).toEqual(['commerce.view_item'])
    expect(formatFindings(checkConformance({ manifest, rum }))).toBe('conformance: ok')
  })

  it('stays in pixel mode when analytics is passed, and reads nothing from the theme', async () => {
    page(byName('product page'))
    const rum = createFakeRum({})
    await shopifyPlugin({ analytics: { subscribe: () => {} } }).onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(rum.actions()).toHaveLength(0)
  })
})
