import {
  ACCOUNT_ATTRIBUTES,
  COMMERCE_ATTRIBUTES,
  ENGAGEMENT_ATTRIBUTES,
  LEAD_ATTRIBUTES,
  SUPPORT_ATTRIBUTES,
  type AttributeSpec,
} from './attributes.js'

export * from './attributes.js'
export * from './registry.js'

import {
  ACCOUNT_FAMILY,
  COMMERCE_FAMILY,
  ENGAGEMENT_FAMILY,
  LEAD_FAMILY,
  SUPPORT_FAMILY,
  allFamilies,
  bareEvent,
  type FamilyName,
} from './registry.js'

/**
 * Every valid action name with its default prefix, e.g. `commerce.purchase`.
 *
 * A function, not a constant. Only the conformance suite and the docs generator need it, and as a
 * top-level `flatMap` it counted as a side effect — which kept every family's event names in every
 * plugin's CDN bundle, however little of the schema that plugin emits.
 */
export function allActionNames(): string[] {
  return allFamilies().flatMap((family) => family.events.map((event) => `${family.prefix}${event}`))
}

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
  prefix: COMMERCE_FAMILY.prefix,
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

/**
 * Engagement: the events analytics tools capture automatically — scroll depth, downloads,
 * outbound and contact clicks, video, forms. The point of the family is that a site gets them
 * with no instrumentation, which is also why none of them may carry a URL or a field value.
 */
export const ENGAGEMENT: FamilySpec = {
  family: 'engagement',
  prefix: ENGAGEMENT_FAMILY.prefix,
  attributes: ENGAGEMENT_ATTRIBUTES,
  actions: [
    { event: 'scroll', ga4: 'scroll', firesWhen: 'The visitor reaches a depth threshold', keyAttributes: ['percent_scrolled'] },
    { event: 'click', ga4: 'click', firesWhen: 'An outbound, mailto or tel link is clicked', keyAttributes: ['link_domain', 'link_type', 'outbound'] },
    { event: 'file_download', ga4: 'file_download', firesWhen: 'A link to a document, archive or media file is clicked', keyAttributes: ['file_name', 'file_extension', 'link_domain'] },
    { event: 'video_start', ga4: 'video_start', firesWhen: 'A video begins playing', keyAttributes: ['video_title', 'video_provider', 'video_duration'] },
    { event: 'video_progress', ga4: 'video_progress', firesWhen: 'A video passes a progress threshold', keyAttributes: ['video_percent', 'video_title'] },
    { event: 'video_complete', ga4: 'video_complete', firesWhen: 'A video reaches the end', keyAttributes: ['video_title'] },
    { event: 'form_start', ga4: 'form_start', firesWhen: 'The visitor first interacts with a form', keyAttributes: ['form_id', 'form_name'] },
    { event: 'form_submit', ga4: 'form_submit', firesWhen: 'A form is submitted', keyAttributes: ['form_id', 'form_name', 'form_destination'] },
  ],
}

export const ACCOUNT: FamilySpec = {
  family: 'account',
  prefix: ACCOUNT_FAMILY.prefix,
  attributes: ACCOUNT_ATTRIBUTES,
  actions: [
    { event: 'login', ga4: 'login', firesWhen: 'Auth state becomes signed in', keyAttributes: ['method'] },
    { event: 'sign_up', ga4: 'sign_up', firesWhen: 'A new account is created', keyAttributes: ['method'] },
    { event: 'logout', ga4: null, firesWhen: 'Auth state becomes signed out', keyAttributes: [] },
  ],
}

export const LEAD: FamilySpec = {
  family: 'lead',
  prefix: LEAD_FAMILY.prefix,
  attributes: LEAD_ATTRIBUTES,
  actions: [
    { event: 'generate_lead', ga4: 'generate_lead', firesWhen: 'A lead form is submitted', keyAttributes: ['form_id', 'form_name'] },
  ],
}

export const SUPPORT: FamilySpec = {
  family: 'support',
  prefix: SUPPORT_FAMILY.prefix,
  attributes: SUPPORT_ATTRIBUTES,
  actions: [
    { event: 'chat_opened', ga4: null, firesWhen: 'The support widget is shown', keyAttributes: ['provider'] },
  ],
}

export const FAMILIES: Record<FamilyName, FamilySpec> = {
  commerce: COMMERCE,
  engagement: ENGAGEMENT,
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
