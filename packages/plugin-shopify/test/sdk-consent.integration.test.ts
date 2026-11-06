/**
 * An adapter must never release RUM a consent plugin is holding. Shopify's Customer Privacy API
 * says yes, but OneTrust's banner is unanswered: nothing may reach the intake.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { initRum, type RumHarness } from '../../plugin-woocommerce/test/support/initRum.js'
import { oneTrustPlugin } from '../../plugin-onetrust/src/index.js'
import { shopifyPlugin } from '../src/index.js'
import type { ShopifyAnalyticsApi } from '../src/types.js'

let rum: RumHarness
const analytics: ShopifyAnalyticsApi = { subscribe: () => {} }

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).Shopify = {
    shop: 'acme.myshopify.com',
    customerPrivacy: { analyticsProcessingAllowed: () => true },
  }
  rum = await initRum([oneTrustPlugin({ timeoutMs: 50 }), shopifyPlugin({ analytics })])
  await rum.waitForBatch()
})

afterAll(() => {
  rum.restore()
  delete (globalThis as Record<string, unknown>).Shopify
})

it('sends nothing while OneTrust is holding RUM, even though Shopify allows analytics', () => {
  expect(rum.intake.requestCount()).toBe(0)
})
