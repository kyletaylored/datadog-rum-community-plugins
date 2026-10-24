import {
  ACCOUNT_ATTRIBUTES,
  COMMERCE_ATTRIBUTES,
  LEAD_ATTRIBUTES,
  SUPPORT_ATTRIBUTES,
  type AttributeSpec,
} from './attributes.js'

export * from './attributes.js'
export * from './registry.js'

import { FAMILY_EVENTS, FAMILY_PREFIX, bareEvent, type FamilyName } from './registry.js'

/**
 * Every valid action name with its default prefix, e.g. `commerce.purchase`.
 *
 * Lives here rather than in the runtime registry: only the conformance suite and the docs
 * generator need it, and computing it at module load put a dead expression in every CDN bundle.
 */
export const ALL_ACTION_NAMES: string[] = (Object.keys(FAMILY_EVENTS) as FamilyName[]).flatMap((family) =>
  FAMILY_EVENTS[family].map((event) => `${FAMILY_PREFIX[family]}${event}`),
)

export interface ActionSpec {
  /** Name without the family prefix, as GA4 spells it where GA4 has an equivalent. */
  event: string
  /** The GA4 event this maps to, or `null` where GA4 has none. */
  ga4: string | null
  firesWhen: string
  /** Attributes a conforming adapter is expected to send. */
  keyAttributes: string[]
}

export interface FamilySpec {
  family: FamilyName
  /** Default action prefix, overridable per install with `actionPrefix`. */
  prefix: string
  attributes: Record<string, AttributeSpec>
  actions: ActionSpec[]
}

export const COMMERCE: FamilySpec = {
  family: 'commerce',
  prefix: FAMILY_PREFIX.commerce,
  attributes: COMMERCE_ATTRIBUTES,
  actions: [
    { event: 'view_item_list', ga4: 'view_item_list', firesWhen: 'Collection or category page shown', keyAttributes: ['item_list_name', 'items'] },
    { event: 'view_item', ga4: 'view_item', firesWhen: 'Product detail page shown', keyAttributes: ['value', 'currency', 'items'] },
    { event: 'add_to_cart', ga4: 'add_to_cart', firesWhen: 'Item added or quantity raised', keyAttributes: ['value', 'currency', 'items', 'cart_id'] },
    { event: 'remove_from_cart', ga4: 'remove_from_cart', firesWhen: 'Item removed or quantity lowered', keyAttributes: ['value', 'currency', 'items', 'cart_id'] },
    { event: 'view_cart', ga4: 'view_cart', firesWhen: 'Cart page or drawer opened', keyAttributes: ['value', 'currency', 'item_count'] },
    { event: 'begin_checkout', ga4: 'begin_checkout', firesWhen: 'Checkout entered', keyAttributes: ['value', 'currency', 'item_count', 'coupon'] },
    { event: 'add_shipping_info', ga4: 'add_shipping_info', firesWhen: 'Shipping step submitted', keyAttributes: ['value', 'currency', 'shipping_tier'] },
    { event: 'add_payment_info', ga4: 'add_payment_info', firesWhen: 'Payment step submitted', keyAttributes: ['value', 'currency', 'payment_type'] },
    { event: 'purchase', ga4: 'purchase', firesWhen: 'Order confirmation seen', keyAttributes: ['transaction_id', 'value', 'currency', 'tax', 'shipping', 'coupon', 'item_count'] },
    { event: 'search', ga4: 'search', firesWhen: 'Store search run', keyAttributes: ['search_term_length'] },
  ],
}

export const ACCOUNT: FamilySpec = {
  family: 'account',
  prefix: FAMILY_PREFIX.account,
  attributes: ACCOUNT_ATTRIBUTES,
  actions: [
    { event: 'login', ga4: 'login', firesWhen: 'Auth state becomes signed in', keyAttributes: ['method'] },
    { event: 'sign_up', ga4: 'sign_up', firesWhen: 'A new account is created', keyAttributes: ['method'] },
    { event: 'logout', ga4: null, firesWhen: 'Auth state becomes signed out', keyAttributes: [] },
  ],
}

export const LEAD: FamilySpec = {
  family: 'lead',
  prefix: FAMILY_PREFIX.lead,
  attributes: LEAD_ATTRIBUTES,
  actions: [
    { event: 'generate_lead', ga4: 'generate_lead', firesWhen: 'A lead form is submitted', keyAttributes: ['form_id', 'form_name'] },
  ],
}

export const SUPPORT: FamilySpec = {
  family: 'support',
  prefix: FAMILY_PREFIX.support,
  attributes: SUPPORT_ATTRIBUTES,
  actions: [
    { event: 'chat_opened', ga4: null, firesWhen: 'The support widget is shown', keyAttributes: ['provider'] },
  ],
}

export const FAMILIES: Record<FamilyName, FamilySpec> = {
  commerce: COMMERCE,
  account: ACCOUNT,
  lead: LEAD,
  support: SUPPORT,
}



/** The full spec for the family an event belongs to, metadata included. */
export function familyOf(eventOrName: string): FamilySpec | undefined {
  return Object.values(FAMILIES).find((f) => f.actions.some((a) => a.event === bareEvent(eventOrName)))
}

/** Look up an action spec by its bare or prefixed event name. */
export function actionSpec(event: string): ActionSpec | undefined {
  const bare = bareEvent(event)
  for (const family of Object.values(FAMILIES)) {
    const found = family.actions.find((a) => a.event === bare)
    if (found) return found
  }
  return undefined
}
