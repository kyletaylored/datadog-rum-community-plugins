/**
 * The PRD's Phase 0 exit gate: no RUM data leaves the page before consent. Its own file, so it
 * gets its own browser page and its own SDK init.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { initRum, type RumHarness } from './support/initRum.js'
import { wooCommercePlugin } from '../src/index.js'
import type { WooGlobalPayload } from '../src/types.js'

const ORDER: WooGlobalPayload = {
  store: { id: 'shop.example.com', currency: 'USD' },
  customer: { id: 42, email: 'shopper@example.com' },
  order: { transaction_id: 'wc_3001', value: 100.6, currency: 'USD' },
}

let rum: RumHarness

beforeAll(async () => {
  // No `consent` option, so the plugin sets trackingConsent to not-granted in onInit. That stops
  // the SDK sending anything at all, not just this plugin's actions.
  rum = await initRum([wooCommercePlugin({ data: ORDER })])
  await rum.waitForBatch()
})

afterAll(() => rum.restore())

it('sends nothing to the intake before consent is granted', () => {
  expect(rum.intake.requestCount()).toBe(0)
  expect(rum.intake.customActions()).toHaveLength(0)
})

it('leaks neither the order nor the customer', () => {
  const sent = JSON.stringify(rum.intake.events())
  expect(sent).not.toContain('wc_3001')
  expect(sent).not.toContain('shopper@example.com')
})
