/**
 * Browser SDK v7 skips init for the whole page when any plugin's onInit returns false. Installed
 * on a storefront without the pixel's `analytics`, this plugin must leave the rest of RUM running.
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { initRum, type RumHarness } from '../../plugin-woocommerce/test/support/initRum.js'
import { shopifyPlugin } from '../src/index.js'

let rum: RumHarness

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  rum = await initRum([shopifyPlugin()])
  await rum.waitForBatch()
})

afterAll(() => {
  rum.restore()
  vi.restoreAllMocks()
})

it('leaves RUM running when no analytics API was passed', () => {
  expect(rum.intake.requestCount()).toBeGreaterThan(0)
  expect(rum.intake.events().some((event) => (event as { type?: string }).type === 'view')).toBe(true)
})
