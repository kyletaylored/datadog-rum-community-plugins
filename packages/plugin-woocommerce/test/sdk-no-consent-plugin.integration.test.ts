/**
 * The other half of the consent contract: with default options and no consent plugin on the
 * page, the adapter must not hold RUM. An adapter that set trackingConsent to not-granted with
 * nothing to grant it later would switch off all of RUM, not just its own events.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { initRum, type RumHarness } from './support/initRum.js'
import { wooCommercePlugin } from '../src/index.js'
import type { WooGlobalPayload } from '../src/types.js'

const ORDER: WooGlobalPayload = {
  store: { id: 'shop.example.com', currency: 'USD' },
  order: { transaction_id: 'wc_4001', value: 12.5, currency: 'USD' },
}

let rum: RumHarness

beforeAll(async () => {
  rum = await initRum([wooCommercePlugin({ data: ORDER })])
})

afterAll(() => rum.restore())

it('sends the purchase, and the rest of RUM, with default options', async () => {
  const purchases = await rum.waitForAction('commerce.purchase')
  expect(purchases).toHaveLength(1)
  expect(rum.intake.events().some((event) => (event as { type?: string }).type === 'view')).toBe(true)
})
