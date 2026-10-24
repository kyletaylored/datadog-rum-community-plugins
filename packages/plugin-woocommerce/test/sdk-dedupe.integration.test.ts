/**
 * A refreshed thank-you page must not double-count revenue. Its own file, because it needs two
 * SDK inits over one `localStorage` and two instances cannot share a page.
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { initRum, type RumHarness } from './support/initRum.js'
import { wooCommercePlugin } from '../src/index.js'
import type { WooGlobalPayload } from '../src/types.js'

const ORDER: WooGlobalPayload = {
  store: { id: 'shop.example.com', currency: 'USD' },
  order: { transaction_id: 'wc_4001', value: 100.6, currency: 'USD' },
}

let rum: RumHarness
let secondInitActions: { name: string }[]

beforeAll(async () => {
  rum = await initRum([wooCommercePlugin({ consent: 'ignore', data: ORDER })])
  expect(await rum.waitForAction('commerce.purchase')).toHaveLength(1)

  // The reload: a second adapter instance reading the same payload, over the same localStorage.
  // Only the adapter is re-created; re-initializing the SDK in the same page is not something a
  // reload does, and two SDK instances would fight over the session.
  const before = rum.intake.customActions().length
  const reloaded = wooCommercePlugin({ consent: 'ignore', data: ORDER })
  const { datadogRum } = await import('@datadog/browser-rum')
  await reloaded.onInit?.({
    initConfiguration: {},
    publicApi: datadogRum as never,
  })
  await rum.waitForBatch()
  await new Promise((resolve) => setTimeout(resolve, 300))
  secondInitActions = rum.intake.customActions().slice(before)
})

afterAll(() => {
  rum.restore()
  vi.resetModules()
})

it('counts the order once across a reload', () => {
  expect(rum.intake.customActions().filter((action) => action.name === 'commerce.purchase')).toHaveLength(1)
})

it('sends no purchase at all on the second pass', () => {
  expect(secondInitActions.filter((action) => action.name === 'commerce.purchase')).toHaveLength(0)
})
