/**
 * The real-SDK integration test from the PRD: `@datadog/browser-rum` runs with the adapter in
 * `plugins: [...]`, intake requests are intercepted, and the actions in them are asserted.
 *
 * This is the test that proves the plugin contract still holds. The fixture tests use a fake
 * `publicApi`, so they would keep passing if the SDK changed how it calls plugins; this one
 * would not. CI also runs it weekly against the latest SDK release.
 *
 * It runs in headless Chromium, not jsdom: under jsdom the SDK never starts a session, so no
 * event would ever reach the intake and the test would pass for the wrong reason.
 *
 * One `init` per file, because that is what a real page does and because two SDK instances in
 * one page fight over the same session. The consent and dedupe cases need their own `init`, so
 * they live in their own files and get their own page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initRum, type RumHarness } from './support/initRum.js'
import type { WooGlobalPayload } from '../src/types.js'
import { wooCommercePlugin } from '../src/index.js'

const ORDER: WooGlobalPayload = {
  store: { id: 'shop.example.com', currency: 'USD', locale: 'en-US' },
  customer: { id: 42, email: 'shopper@example.com', name: 'Jane Shopper', type: 'returning' },
  order: {
    transaction_id: 'wc_2001',
    value: 100.6,
    currency: 'USD',
    tax: 6.2,
    shipping: 4.95,
    coupon: 'WELCOME10',
    item_count: 3,
    unique_items: 2,
  },
}

let rum: RumHarness
let purchases: { name: string; context: Record<string, unknown> }[]

beforeAll(async () => {
  rum = await initRum([wooCommercePlugin({ consent: 'ignore', data: ORDER })])
  purchases = await rum.waitForAction('commerce.purchase')
})

afterAll(() => rum.restore())

describe('with the real browser-rum SDK', () => {
  it('sends commerce.purchase to the intake, once, with its attributes intact', () => {
    expect(purchases).toHaveLength(1)
    expect(purchases[0]?.context).toMatchObject({
      transaction_id: 'wc_2001',
      value: 100.6,
      currency: 'USD',
      tax: 6.2,
      shipping: 4.95,
      coupon: 'WELCOME10',
      item_count: 3,
    })
  })

  it('carries the store and platform context the plugin set globally', () => {
    expect(purchases[0]?.context).toMatchObject({
      'commerce.platform': 'woocommerce',
      'commerce.schema_version': '1.0.0',
      'store.id': 'shop.example.com',
      'store.currency': 'USD',
      'customer.type': 'returning',
    })
  })

  it('sends numbers as numbers, so value can become a distribution metric', () => {
    expect(typeof purchases[0]?.context.value).toBe('number')
    expect(typeof purchases[0]?.context.item_count).toBe('number')
  })

  it('attaches the customer ID to the session', () => {
    const identified = rum.intake.events().filter((event) => event.usr?.id !== undefined)
    expect(identified.length).toBeGreaterThan(0)
    expect(identified[0]?.usr).toMatchObject({ id: '42' })
  })

  it('leaks no email, name or card data into anything it sent', () => {
    const sent = JSON.stringify(rum.intake.events())
    expect(sent).not.toContain('shopper@example.com')
    expect(sent).not.toContain('Jane Shopper')
  })
})
