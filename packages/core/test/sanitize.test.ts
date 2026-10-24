import { describe, expect, it } from 'vitest'
import {
  MAX_ITEMS,
  MAX_STRING_LENGTH,
  isBlockedKey,
  money,
  sanitizeContext,
  sanitizeItems,
} from '../src/index.js'

describe('isBlockedKey', () => {
  const blocked = [
    'card_number',
    'cardNumber',
    'card-number',
    'cvv',
    'CVC',
    'security_code',
    'iban',
    'routing_number',
    'billing_address',
    'address_line1',
    'postal_code',
    'zip',
    'email',
    'emailAddress',
    'phone_number',
    'ssn',
    'password',
    'first_name',
    'lastName',
    'search_term',
    'query',
    'note',
  ]

  it.each(blocked)('blocks %s', (key) => {
    expect(isBlockedKey(key)).toBe(true)
  })

  const allowed = ['value', 'currency', 'transaction_id', 'item_count', 'coupon', 'payment_type', 'search_term_length', 'cart_id', 'id']

  it.each(allowed)('allows %s', (key) => {
    expect(isBlockedKey(key)).toBe(false)
  })
})

describe('sanitizeContext', () => {
  it('strips payment data even when the platform payload carries it', () => {
    const output = sanitizeContext({
      value: 100.6,
      card_number: '4242424242424242',
      cvv: '123',
      billing_address: '1 Market St',
    })
    expect(output).toEqual({ value: 100.6 })
  })

  it('truncates long strings at the cap', () => {
    const output = sanitizeContext({ coupon: 'x'.repeat(400) })
    expect(output.coupon).toHaveLength(MAX_STRING_LENGTH)
  })

  it('drops empty and non-finite values rather than sending nulls', () => {
    expect(sanitizeContext({ a: undefined, b: null, c: '', d: NaN, e: Infinity })).toEqual({})
  })

  it('keeps numbers as numbers so they can become RUM measures', () => {
    expect(sanitizeContext({ value: 84.5, item_count: 3 })).toEqual({ value: 84.5, item_count: 3 })
  })

  it('drops a branch that nests deeper than the cap rather than walking an arbitrary payload', () => {
    // Past MAX_DEPTH the nested object comes back empty, and an empty object is dropped by its
    // parent, so the whole over-deep branch disappears instead of being partly sent.
    const deep = { l1: { l2: { l3: { l4: { l5: { leak: 'too deep' } } } } } }
    expect(sanitizeContext(deep)).toEqual({})
  })

  it('keeps a branch that sits within the cap', () => {
    expect(sanitizeContext({ l1: { l2: { l3: { keep: 'shallow enough' } } } })).toEqual({
      l1: { l2: { l3: { keep: 'shallow enough' } } },
    })
  })

  it('strips blocked keys nested inside objects', () => {
    const output = sanitizeContext({ payment: { payment_type: 'paypal', card_number: '4242' } })
    expect(output).toEqual({ payment: { payment_type: 'paypal' } })
  })
})

describe('sanitizeItems', () => {
  it('keeps only GA4 item fields', () => {
    const items = sanitizeItems([
      { item_id: 'TEE', item_name: 'Tee', price: 28, quantity: 2, sku_internal: 'leak', email: 'a@b.c' },
    ])
    expect(items).toEqual([{ item_id: 'TEE', item_name: 'Tee', price: 28, quantity: 2 }])
  })

  it('caps the array at 20 entries', () => {
    const items = sanitizeItems(Array.from({ length: 50 }, (_, i) => ({ item_id: `SKU-${i}` })))
    expect(items).toHaveLength(MAX_ITEMS)
  })

  it('coerces numeric strings, which is how several platforms send price', () => {
    expect(sanitizeItems([{ item_id: 'A', price: '28.50', quantity: '2' }])).toEqual([
      { item_id: 'A', price: 28.5, quantity: 2 },
    ])
  })

  it('returns undefined for a non-array, so the attribute is simply absent', () => {
    expect(sanitizeItems('nope')).toBeUndefined()
    expect(sanitizeItems([])).toBeUndefined()
  })
})

describe('money', () => {
  it('rounds to cents so floating-point noise never reaches a distribution metric', () => {
    expect(money(0.1 + 0.2)).toBe(0.3)
    expect(money('84.499')).toBe(84.5)
  })

  it('rejects values that are not finite numbers', () => {
    expect(money('abc')).toBeUndefined()
    expect(money(null)).toBeUndefined()
  })
})
