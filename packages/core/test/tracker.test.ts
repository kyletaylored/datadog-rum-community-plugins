import { describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_FAMILY,
  COMMERCE_FAMILY,
  GLOBAL_CONTEXT_KEYS,
  SCHEMA_VERSION,
  createDedupe,
  createTracker,
} from '../src/index.js'
import { createFakeRum, createMemoryStorage } from '../../test-harness/src/index.js'
import type { CommonPluginOptions } from '../src/index.js'

const FOOTPRINT = {
  globals: ['window.test'],
  events: ['test_event'],
  rumApis: ['addAction', 'setGlobalContextProperty', 'setUser', 'clearUser'],
  consentSource: null,
}

function setup(options: CommonPluginOptions = {}, initConfiguration: Record<string, unknown> = {}) {
  const rum = createFakeRum(initConfiguration)
  const tracker = createTracker({
    platform: 'test',
    version: '0.1.0',
    publicApi: rum.publicApi,
    families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
    initConfiguration: rum.initConfiguration,
    options: { consent: 'ignore', ...options },
    footprint: FOOTPRINT,
    dedupe: createDedupe({ namespace: 'test', storage: createMemoryStorage() }),
  })
  return { rum, tracker }
}

describe('session context', () => {
  it('sets platform, plugin version and schema version on init', () => {
    const { rum } = setup()
    expect(rum.globalContext()).toMatchObject({
      [GLOBAL_CONTEXT_KEYS.platform]: 'test',
      [GLOBAL_CONTEXT_KEYS.pluginVersion]: '0.1.0',
      [GLOBAL_CONTEXT_KEYS.schemaVersion]: SCHEMA_VERSION,
    })
  })

  it('normalizes the store currency to upper case so metrics tag consistently', () => {
    const { rum, tracker } = setup()
    tracker.setStore({ id: 'shop.example.com', currency: 'usd', locale: 'en-US' })
    expect(rum.globalContext()[GLOBAL_CONTEXT_KEYS.storeCurrency]).toBe('USD')
  })

  it('sets customer type once per value, not on every repeat', () => {
    const { rum, tracker } = setup()
    tracker.setCustomerType('returning')
    tracker.setCustomerType('returning')
    const writes = rum.calls.filter(
      (call) => call.api === 'setGlobalContextProperty' && call.key === GLOBAL_CONTEXT_KEYS.customerType,
    )
    expect(writes).toHaveLength(1)
  })
})

describe('track', () => {
  it('prefixes commerce actions and sends the filtered attributes', () => {
    const { rum, tracker } = setup()
    expect(tracker.track('add_to_cart', { value: 28, currency: 'USD', card_number: '4242' })).toBe(true)
    expect(rum.actions()).toEqual([
      { api: 'addAction', name: 'commerce.add_to_cart', context: { value: 28, currency: 'USD' } },
    ])
  })

  it('accepts a prefixed name as well as a bare event', () => {
    const { rum, tracker } = setup()
    tracker.track('commerce.view_cart', { value: 10 })
    expect(rum.actions()[0]?.name).toBe('commerce.view_cart')
  })

  it('rejects an event that is not in the schema', () => {
    const { rum, tracker } = setup()
    expect(tracker.track('order_complete', { value: 10 })).toBe(false)
    expect(rum.actions()).toHaveLength(0)
  })

  it('honours the events allow-list, with or without the prefix', () => {
    const { rum, tracker } = setup({ events: ['purchase', 'commerce.view_cart'] })
    tracker.track('add_to_cart', { value: 28 })
    tracker.track('view_cart', { value: 28 })
    expect(rum.actions().map((action) => action.name)).toEqual(['commerce.view_cart'])
  })

  it('renames only the commerce prefix, never another family', () => {
    const { rum, tracker } = setup({ actionPrefix: 'shop.' })
    tracker.track('add_to_cart', { value: 28 })
    tracker.track('login', { method: 'password' })
    expect(rum.actions().map((action) => action.name)).toEqual(['shop.add_to_cart', 'account.login'])
  })

  it('withholds items[] unless includeItems is on', () => {
    const items = [{ item_id: 'TEE', price: 28, quantity: 1 }]
    const off = setup()
    off.tracker.track('add_to_cart', { value: 28, items })
    expect(off.rum.actions()[0]?.context.items).toBeUndefined()

    const on = setup({ includeItems: true })
    on.tracker.track('add_to_cart', { value: 28, items })
    expect(on.rum.actions()[0]?.context.items).toEqual(items)
  })
})

describe('purchase dedupe', () => {
  it('fires once per transaction_id', () => {
    const { rum, tracker } = setup()
    expect(tracker.track('purchase', { transaction_id: 'wc_1042', value: 100.6 })).toBe(true)
    expect(tracker.track('purchase', { transaction_id: 'wc_1042', value: 100.6 })).toBe(false)
    expect(tracker.track('purchase', { transaction_id: 'wc_1043', value: 20 })).toBe(true)
    expect(rum.actions()).toHaveLength(2)
  })

  it('drops a purchase with no transaction_id, since revenue could not be deduplicated', () => {
    const { rum, tracker } = setup()
    expect(tracker.track('purchase', { value: 100.6 })).toBe(false)
    expect(rum.actions()).toHaveLength(0)
  })
})

describe('consent gate', () => {
  it('sets trackingConsent to not-granted in onInit and drops events until granted', () => {
    const rum = createFakeRum({})
    const tracker = createTracker({
      platform: 'test',
      version: '0.1.0',
      publicApi: rum.publicApi,
      families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
    families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
      initConfiguration: rum.initConfiguration,
      options: {},
      footprint: FOOTPRINT,
      dedupe: createDedupe({ namespace: 'test', storage: createMemoryStorage() }),
    })

    expect(rum.initConfiguration.trackingConsent).toBe('not-granted')
    expect(tracker.track('add_to_cart', { value: 28 })).toBe(false)

    tracker.consent.grant(['C0001', 'C0002'])
    expect(tracker.track('add_to_cart', { value: 28 })).toBe(true)
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
    expect(rum.globalContext()[GLOBAL_CONTEXT_KEYS.consentCategories]).toEqual(['C0001', 'C0002'])
  })

  it('does not backfill events that happened while consent was pending', () => {
    const rum = createFakeRum({})
    const tracker = createTracker({
      platform: 'test',
      version: '0.1.0',
      publicApi: rum.publicApi,
      families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
    families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
      initConfiguration: rum.initConfiguration,
      options: {},
      footprint: FOOTPRINT,
    })
    tracker.track('add_to_cart', { value: 28 })
    tracker.consent.grant()
    expect(rum.actions()).toHaveLength(0)
  })

  it('leaves the host page in charge when consent is ignore', () => {
    const rum = createFakeRum({ trackingConsent: 'granted' })
    createTracker({
      platform: 'test',
      version: '0.1.0',
      publicApi: rum.publicApi,
      families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
    families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
      initConfiguration: rum.initConfiguration,
      options: { consent: 'ignore' },
      footprint: FOOTPRINT,
    })
    expect(rum.initConfiguration.trackingConsent).toBe('granted')
  })

  it('hands the decision to a resolver when one is supplied', () => {
    const rum = createFakeRum({})
    let notify: ((granted: boolean, categories?: string[]) => void) | undefined
    const tracker = createTracker({
      platform: 'test',
      version: '0.1.0',
      publicApi: rum.publicApi,
      families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
    families: [COMMERCE_FAMILY, ACCOUNT_FAMILY],
      initConfiguration: rum.initConfiguration,
      options: { consent: (cb) => void (notify = cb) },
      footprint: FOOTPRINT,
    })

    expect(tracker.track('view_cart', { value: 10 })).toBe(false)
    notify?.(true, ['analytics'])
    expect(tracker.track('view_cart', { value: 10 })).toBe(true)
  })
})

describe('identity', () => {
  it('sends only the platform ID by default', () => {
    const { rum, tracker } = setup()
    tracker.identify({ id: '42', email: 'shopper@example.com', name: 'Jane Shopper' })
    expect(rum.calls).toContainEqual({ api: 'setUser', user: { id: '42' } })
  })

  it('adds email and name only when opted in', () => {
    const { rum, tracker } = setup({ includeEmail: true, includeName: true })
    tracker.identify({ id: '42', email: 'shopper@example.com', name: 'Jane Shopper' })
    expect(rum.calls).toContainEqual({
      api: 'setUser',
      user: { id: '42', email: 'shopper@example.com', name: 'Jane Shopper' },
    })
  })

  it('skips setUser entirely when identifyUsers is off', () => {
    const { rum, tracker } = setup({ identifyUsers: false })
    tracker.identify({ id: '42' })
    expect(rum.calls.some((call) => call.api === 'setUser')).toBe(false)
  })

  it('filters extra user properties like any other attribute', () => {
    const { rum, tracker } = setup()
    tracker.identify({ id: '42', properties: { tier: 'gold', phone: '+15551234567' } })
    expect(rum.calls).toContainEqual({ api: 'setUser', user: { id: '42', tier: 'gold' } })
  })

  it('clears the user and the account on logout', () => {
    const { rum, tracker } = setup()
    tracker.clearIdentity()
    expect(rum.calls.map((call) => call.api)).toContain('clearUser')
    expect(rum.calls.map((call) => call.api)).toContain('clearAccount')
  })

  it('sets an account for B2B storefronts', () => {
    const { rum, tracker } = setup({ includeName: true })
    tracker.identifyAccount({ id: 'org_19x', name: 'Acme Co' })
    expect(rum.calls).toContainEqual({ api: 'setAccount', account: { id: 'org_19x', name: 'Acme Co' } })
  })
})

describe('beforeTrack', () => {
  it('can drop an event', () => {
    const { rum, tracker } = setup({ beforeTrack: () => false })
    expect(tracker.track('add_to_cart', { value: 28 })).toBe(false)
    expect(rum.actions()).toHaveLength(0)
  })

  it('can edit attributes', () => {
    const { rum, tracker } = setup({
      beforeTrack: (event) => ({ ...event, context: { ...event.context, coupon: 'EDITED' } }),
    })
    tracker.track('add_to_cart', { value: 28 })
    expect(rum.actions()[0]?.context).toEqual({ value: 28, coupon: 'EDITED' })
  })

  it('cannot reintroduce a blocked key', () => {
    const { rum, tracker } = setup({
      beforeTrack: (event) => ({ ...event, context: { ...event.context, card_number: '4242' } }),
    })
    tracker.track('add_to_cart', { value: 28 })
    expect(rum.actions()[0]?.context).toEqual({ value: 28 })
  })

  it('sends the event unchanged when the hook throws, rather than breaking the page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rum, tracker } = setup({
      debug: true,
      beforeTrack: () => {
        throw new Error('hook bug')
      },
    })
    expect(tracker.track('add_to_cart', { value: 28 })).toBe(true)
    expect(rum.actions()[0]?.context).toEqual({ value: 28 })
    warn.mockRestore()
  })
})
