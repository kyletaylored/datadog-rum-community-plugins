import { describe, expect, it } from 'vitest'
import { DEDUPE_TTL_MS, createDedupe } from '../src/index.js'
import { createMemoryStorage } from '../../test-harness/src/index.js'

describe('createDedupe', () => {
  it('claims a key once', () => {
    const dedupe = createDedupe({ namespace: 'woo', storage: createMemoryStorage() })
    expect(dedupe.claim('wc_1042')).toBe(true)
    expect(dedupe.claim('wc_1042')).toBe(false)
    expect(dedupe.claim('wc_1043')).toBe(true)
  })

  it('survives a page reload by reading the same storage back', () => {
    const storage = createMemoryStorage()
    expect(createDedupe({ namespace: 'woo', storage }).claim('wc_1042')).toBe(true)
    // A fresh instance is what a refreshed thank-you page gets.
    expect(createDedupe({ namespace: 'woo', storage }).claim('wc_1042')).toBe(false)
  })

  it('lets the same order through again after the 24-hour window', () => {
    const storage = createMemoryStorage()
    let now = 1_700_000_000_000
    const clock = () => now

    expect(createDedupe({ namespace: 'woo', storage, now: clock }).claim('wc_1042')).toBe(true)
    now += DEDUPE_TTL_MS + 1
    expect(createDedupe({ namespace: 'woo', storage, now: clock }).claim('wc_1042')).toBe(true)
  })

  it('namespaces adapters so two plugins on one page do not collide', () => {
    const storage = createMemoryStorage()
    expect(createDedupe({ namespace: 'woo', storage }).claim('1042')).toBe(true)
    expect(createDedupe({ namespace: 'shopify', storage }).claim('1042')).toBe(true)
  })

  it('still prevents duplicates on the same page when storage is unavailable', () => {
    const dedupe = createDedupe({ namespace: 'woo', storage: null })
    expect(dedupe.storageKeys).toEqual([])
    expect(dedupe.claim('wc_1042')).toBe(true)
    expect(dedupe.claim('wc_1042')).toBe(false)
  })

  it('survives corrupted storage rather than throwing on a merchant page', () => {
    const storage = createMemoryStorage()
    storage.setItem('dd_rum_commerce_seen', 'not json')
    expect(createDedupe({ namespace: 'woo', storage }).claim('wc_1042')).toBe(true)
  })

  it('keeps the stored entry bounded', () => {
    const storage = createMemoryStorage()
    const dedupe = createDedupe({ namespace: 'woo', storage })
    for (let i = 0; i < 120; i += 1) dedupe.claim(`order-${i}`)
    const stored = JSON.parse(storage.getItem('dd_rum_commerce_seen') ?? '{}')
    expect(Object.keys(stored).length).toBeLessThanOrEqual(50)
  })

  it('declares the storage key it writes, for the footprint', () => {
    expect(createDedupe({ namespace: 'woo', storage: createMemoryStorage() }).storageKeys).toEqual([
      'dd_rum_commerce_seen',
    ])
  })
})
