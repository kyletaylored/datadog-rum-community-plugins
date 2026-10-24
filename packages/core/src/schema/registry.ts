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

/** Bumped by RFC. Adapters declare the version they emit in `plugin.json`. */
export const SCHEMA_VERSION = '1.0.0'

export type FamilyName = 'commerce' | 'account' | 'lead' | 'support'

/** Bare event names per family, in the order the docs list them. */
export const FAMILY_EVENTS: Record<FamilyName, readonly string[]> = {
  commerce: [
    'view_item_list',
    'view_item',
    'add_to_cart',
    'remove_from_cart',
    'view_cart',
    'begin_checkout',
    'add_shipping_info',
    'add_payment_info',
    'purchase',
    'search',
  ],
  account: ['login', 'sign_up', 'logout'],
  lead: ['generate_lead'],
  support: ['chat_opened'],
}

export const FAMILY_PREFIX: Record<FamilyName, string> = {
  commerce: 'commerce.',
  account: 'account.',
  lead: 'lead.',
  support: 'support.',
}

const EVENT_TO_FAMILY: Record<string, FamilyName> = (() => {
  const map: Record<string, FamilyName> = {}
  for (const family of Object.keys(FAMILY_EVENTS) as FamilyName[]) {
    for (const event of FAMILY_EVENTS[family]) map[event] = family
  }
  return map
})()

/** Strip a family prefix, so `commerce.purchase`, `shop.purchase` and `purchase` all resolve. */
export function bareEvent(nameOrEvent: string): string {
  const dot = nameOrEvent.indexOf('.')
  return dot === -1 ? nameOrEvent : nameOrEvent.slice(dot + 1)
}

/** The family a bare or prefixed event belongs to, or `undefined` when it is not in the schema. */
export function familyNameOf(nameOrEvent: string): FamilyName | undefined {
  return EVENT_TO_FAMILY[bareEvent(nameOrEvent)]
}

/** Global context keys the core sets. Never high cardinality: no order, cart or user IDs. */
export const GLOBAL_CONTEXT_KEYS = {
  platform: 'commerce.platform',
  pluginVersion: 'commerce.plugin_version',
  schemaVersion: 'commerce.schema_version',
  storeId: 'store.id',
  storeCurrency: 'store.currency',
  storeLocale: 'store.locale',
  customerType: 'customer.type',
  consentCategories: 'consent.categories',
} as const

export type CustomerType = 'guest' | 'new' | 'returning'

/** GA4 item fields allowed inside `items[]`. Anything else is dropped by the core's filter. */
export const ITEM_FIELDS = [
  'item_id',
  'item_name',
  'price',
  'quantity',
  'item_variant',
  'item_category',
] as const

export type ItemField = (typeof ITEM_FIELDS)[number]
