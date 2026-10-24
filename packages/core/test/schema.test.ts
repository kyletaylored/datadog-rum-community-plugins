import { describe, expect, it } from 'vitest'
import {
  ALL_ACTION_NAMES,
  COMMERCE,
  FAMILIES,
  FAMILY_EVENTS,
  FAMILY_PREFIX,
  actionSpec,
  bareEvent,
  familyNameOf,
  familyOf,
  type FamilyName,
} from '../src/index.js'

describe('registry and spec stay in agreement', () => {
  // The runtime registry is deliberately a separate, metadata-free copy so the CDN build stays
  // under its size budget. These assertions are what keeps the two from drifting apart.
  it.each(Object.keys(FAMILIES) as FamilyName[])('%s lists the same events in both', (family) => {
    expect(FAMILIES[family].actions.map((action) => action.event)).toEqual([...FAMILY_EVENTS[family]])
  })

  it.each(Object.keys(FAMILIES) as FamilyName[])('%s uses the same prefix in both', (family) => {
    expect(FAMILIES[family].prefix).toBe(FAMILY_PREFIX[family])
  })

  it('resolves every action name to the same family through both paths', () => {
    for (const name of ALL_ACTION_NAMES) {
      expect(familyNameOf(name)).toBe(familyOf(name)?.family)
    }
  })
})

describe('schema shape', () => {
  it('names commerce actions after GA4, behind the commerce prefix', () => {
    expect(ALL_ACTION_NAMES).toContain('commerce.purchase')
    expect(ALL_ACTION_NAMES).toContain('commerce.add_to_cart')
    expect(ALL_ACTION_NAMES).toContain('account.login')
    expect(ALL_ACTION_NAMES).toContain('lead.generate_lead')
  })

  it('never offers search_term, only its length', () => {
    expect(COMMERCE.attributes.search_term).toBeUndefined()
    expect(COMMERCE.attributes.search_term_length?.type).toBe('integer')
  })

  it('declares every key attribute an action promises', () => {
    for (const family of Object.values(FAMILIES)) {
      for (const action of family.actions) {
        for (const attribute of action.keyAttributes) {
          expect(family.attributes[attribute], `${family.prefix}${action.event}.${attribute}`).toBeDefined()
        }
      }
    }
  })

  it('marks extensions only where GA4 has no field', () => {
    const extensions = Object.entries(COMMERCE.attributes)
      .filter(([, spec]) => spec.origin === 'extension')
      .map(([name]) => name)
      .sort()
    expect(extensions).toEqual(['cart_id', 'item_count', 'search_term_length', 'unique_items'])
  })

  it('sends money and counts as numbers, so they can become RUM measures', () => {
    expect(COMMERCE.attributes.value?.type).toBe('number')
    expect(COMMERCE.attributes.item_count?.type).toBe('integer')
  })
})

describe('name helpers', () => {
  it('strips any prefix, including a renamed one', () => {
    expect(bareEvent('commerce.purchase')).toBe('purchase')
    expect(bareEvent('shop.purchase')).toBe('purchase')
    expect(bareEvent('purchase')).toBe('purchase')
  })

  it('returns undefined for an event outside the schema', () => {
    expect(familyNameOf('order_complete')).toBeUndefined()
    expect(actionSpec('order_complete')).toBeUndefined()
  })
})
