/**
 * The runtime slice of the schema: just enough to resolve an event to its family and prefix.
 *
 * Kept apart from `attributes.ts` and `index.ts` on purpose. Those carry descriptions, examples
 * and GA4 mappings that the docs site and the conformance suite need but a storefront does not,
 * and the CDN build has a 5 KB gzip budget. The tracker imports only this file, so none of that
 * metadata reaches a merchant's page.
 *
 * `families.test.ts` asserts this registry and the full `FAMILIES` spec stay in agreement.
 */


import {
  ACCOUNT_FAMILY,
  COMMERCE_FAMILY,
  ENGAGEMENT_FAMILY,
  LEAD_FAMILY,
  LEARNING_FAMILY,
  SUPPORT_FAMILY,
} from './families/index.js'

export type { RuntimeFamily } from './families/types.js'

import type { RuntimeFamily } from './families/types.js'
type RuntimeFamilyList = readonly RuntimeFamily[]
export * from './keys.js'

import { bareEvent } from './keys.js'
export * from './families/index.js'

export type FamilyName = 'commerce' | 'engagement' | 'account' | 'lead' | 'support' | 'learning'



/**
 * Every family, for tooling: the docs generator, the conformance suite and the schema tests.
 *
 * A function, not an array. Any eager structure that touches all five families — an array, or a
 * map built from `FAMILY.events` — survives bundling even when unused, because a bundler cannot
 * prove a property read on an imported object has no side effect. That left every family's event
 * names in every plugin's CDN bundle. Inside a function body, nothing is evaluated until called,
 * and an uncalled function is dropped outright.
 */
export function allFamilies(): RuntimeFamilyList {
  return [COMMERCE_FAMILY, ENGAGEMENT_FAMILY, ACCOUNT_FAMILY, LEAD_FAMILY, SUPPORT_FAMILY, LEARNING_FAMILY]
}

/** Bare event names per family. Tooling only. */
export function familyEvents(): Record<FamilyName, readonly string[]> {
  const out = {} as Record<FamilyName, readonly string[]>
  for (const family of allFamilies()) out[family.name] = family.events
  return out
}

/** Default prefix per family. Tooling only. */
export function familyPrefixes(): Record<FamilyName, string> {
  const out = {} as Record<FamilyName, string>
  for (const family of allFamilies()) out[family.name] = family.prefix
  return out
}

let eventToFamily: Record<string, FamilyName> | undefined


/** The family a bare or prefixed event belongs to, or `undefined` when it is not in the schema. */
export function familyNameOf(nameOrEvent: string): FamilyName | undefined {
  if (!eventToFamily) {
    eventToFamily = {}
    for (const family of allFamilies()) {
      for (const event of family.events) eventToFamily[event] = family.name
    }
  }
  return eventToFamily[bareEvent(nameOrEvent)]
}




