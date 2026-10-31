/**
 * The handful of constants the tracker needs that are not family-specific.
 *
 * Separate from `registry.ts` so a plugin's bundle gets the version string and the context keys
 * without the event-to-family map for every family in the schema.
 */

/**
 * Bumped by RFC. Adapters declare the version they emit in `plugin.json`.
 *
 * 1.1.0 adds the `engagement` family. 1.2.0 adds the `learning` family. Both are additive only:
 * every earlier action and attribute is unchanged, so a plugin emitting an earlier version stays
 * conformant.
 */
export const SCHEMA_VERSION = '1.2.0'

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

/** Strip a family prefix, so `commerce.purchase`, `shop.purchase` and `purchase` all resolve. */
export function bareEvent(nameOrEvent: string): string {
  const dot = nameOrEvent.indexOf('.')
  return dot === -1 ? nameOrEvent : nameOrEvent.slice(dot + 1)
}

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
