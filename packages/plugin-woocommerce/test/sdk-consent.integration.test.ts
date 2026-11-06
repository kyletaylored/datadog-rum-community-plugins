/**
 * The PRD's Phase 0 exit gate: no RUM data leaves a OneTrust page before consent. Its own file,
 * so it gets its own browser page and its own SDK init.
 *
 * OneTrust and the adapter are separate plugins with separate gates. The adapter has no consent
 * signal of its own and follows OneTrust through the page-wide consent record.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { initRum, type RumHarness } from './support/initRum.js'
import { wooCommercePlugin } from '../src/index.js'
import { oneTrustPlugin } from '../../plugin-onetrust/src/index.js'
import type { WooGlobalPayload } from '../src/types.js'

const ORDER: WooGlobalPayload = {
  store: { id: 'shop.example.com', currency: 'USD' },
  customer: { id: 42, email: 'shopper@example.com' },
  order: { transaction_id: 'wc_3001', value: 100.6, currency: 'USD' },
}

let rum: RumHarness

beforeAll(async () => {
  // The banner has not been answered: no OnetrustActiveGroups on the page. The adapter comes
  // first on purpose, to show the order of `plugins` does not matter.
  rum = await initRum([wooCommercePlugin({ data: ORDER }), oneTrustPlugin({ timeoutMs: 50 })])
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
