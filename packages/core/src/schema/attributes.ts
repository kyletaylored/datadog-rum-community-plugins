/** Attribute specs shared across families. Types are checked by the conformance suite. */

export type AttributeType = 'string' | 'number' | 'integer' | 'boolean' | 'items'

export interface AttributeSpec {
  type: AttributeType
  /** `ga4` where GA4 defines the parameter, `extension` where this schema adds one. */
  origin: 'ga4' | 'extension'
  description: string
  example?: unknown
}

import { ITEM_FIELDS } from './registry.js'

export { ITEM_FIELDS, type ItemField } from './registry.js'

export const COMMERCE_ATTRIBUTES: Record<string, AttributeSpec> = {
  value: {
    type: 'number',
    origin: 'ga4',
    description:
      'Monetary value in the store currency: items affected on cart events, cart total on view_cart and begin_checkout, revenue on purchase.',
    example: 84.5,
  },
  currency: { type: 'string', origin: 'ga4', description: 'ISO 4217 store currency.', example: 'USD' },
  transaction_id: { type: 'string', origin: 'ga4', description: 'Platform order identifier.', example: '#1042' },
  tax: { type: 'number', origin: 'ga4', description: 'Tax charged on the order.', example: 6.2 },
  shipping: { type: 'number', origin: 'ga4', description: 'Shipping charged on the order.', example: 4.95 },
  coupon: { type: 'string', origin: 'ga4', description: 'Discount code applied.', example: 'WELCOME10' },
  payment_type: {
    type: 'string',
    origin: 'ga4',
    description: 'Payment method name. Never card data.',
    example: 'paypal',
  },
  shipping_tier: { type: 'string', origin: 'ga4', description: 'Shipping option chosen.', example: 'Ground' },
  item_list_name: { type: 'string', origin: 'ga4', description: 'Collection or category name.', example: 'Summer sale' },
  items: {
    type: 'items',
    origin: 'ga4',
    description: `GA4 item objects (${ITEM_FIELDS.join(', ')}), capped at 20 entries. Opt-in via includeItems.`,
  },
  item_count: { type: 'integer', origin: 'extension', description: 'Sum of quantities.', example: 3 },
  unique_items: { type: 'integer', origin: 'extension', description: 'Distinct line items.', example: 2 },
  cart_id: { type: 'string', origin: 'extension', description: 'Platform cart identifier.', example: 'c1-8f2a' },
  search_term_length: {
    type: 'integer',
    origin: 'extension',
    description: 'Length of the search query. Replaces GA4 search_term, which can hold PII.',
    example: 12,
  },
}

export const ACCOUNT_ATTRIBUTES: Record<string, AttributeSpec> = {
  method: { type: 'string', origin: 'ga4', description: 'Auth method or connection name.', example: 'google-oauth2' },
  account_id: { type: 'string', origin: 'extension', description: 'Organization or tenant identifier.', example: 'org_19x' },
}

export const LEAD_ATTRIBUTES: Record<string, AttributeSpec> = {
  value: { type: 'number', origin: 'ga4', description: 'Estimated lead value.', example: 100 },
  currency: { type: 'string', origin: 'ga4', description: 'ISO 4217 currency for value.', example: 'USD' },
  form_id: { type: 'string', origin: 'extension', description: 'Form identifier, never its field values.', example: 'hs-4821' },
  form_name: { type: 'string', origin: 'extension', description: 'Form name.', example: 'Contact sales' },
}

export const SUPPORT_ATTRIBUTES: Record<string, AttributeSpec> = {
  provider: { type: 'string', origin: 'extension', description: 'Chat provider name.', example: 'intercom' },
}
