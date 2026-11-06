/**
 * The storefront mode's one browser-only part: a real PerformanceObserver noticing the theme's
 * cart requests by URL, coalescing a burst of them into one read, and ignoring its own read.
 */
import { expect, it } from 'vitest'
import { COMMERCE_FAMILY, createTracker } from '@kyletaylored/datadog-rum-community-plugins'
import { createFakeRum, createMemoryStorage } from '../../test-harness/src/fakePublicApi.js'
import { FOOTPRINT } from '../src/index.js'
import { startStorefront } from '../src/storefront.js'
import storefront from '../fixtures/storefront/storefront.json'
import type { AjaxCart } from '../src/types.js'

const cart = (name: string) => storefront.fixtures.find((fixture) => fixture.name === name)!.payload as AjaxCart

it('reads the cart once after a burst of theme cart requests, and reports the add', async () => {
  const rum = createFakeRum({})
  const reads: AjaxCart[] = [cart('cart before the doll is added'), cart('cart after the doll is added')]
  let readCount = 0
  startStorefront(
    createTracker({ platform: 'shopify', version: '0.0.0', publicApi: rum.publicApi, families: [COMMERCE_FAMILY], footprint: FOOTPRINT }),
    {
      readCart: async () => {
        readCount++
        // The plugin's own read is tagged, so the observer must not count it as theme traffic.
        await fetch('/cart.js?dd_rum=1').catch(() => {})
        return reads.shift()
      },
      storage: createMemoryStorage(),
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 50)) // the session's baseline read

  // What the Mattel theme does on an add: a cache-busted cart.js, then cart.js again.
  await Promise.all([fetch(`/cart.js?cb=${Date.now()}`).catch(() => {}), fetch('/cart/add.js').catch(() => {}), fetch('/cart.js').catch(() => {})])

  const deadline = Date.now() + 3000
  while (rum.actions().length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  await new Promise((resolve) => setTimeout(resolve, 600))

  expect(readCount).toBe(2)
  expect(rum.actions().map((call) => [call.name, call.context.value])).toEqual([['commerce.add_to_cart', 150]])
})
