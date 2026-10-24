/** Shapes WooCommerce puts on its DOM events and on the thank-you page. */

export interface WooCartItem {
  key?: string
  id?: number | string
  name?: string
  quantity?: number
  sku?: string
  variation?: { attribute?: string; value?: string }[]
  categories?: { name?: string }[]
  prices?: {
    price?: string
    regular_price?: string
    currency_code?: string
    /** Woo sends integer minor units with this exponent, e.g. 2499 with 2 → 24.99. */
    currency_minor_unit?: number
  }
  totals?: { line_total?: string; currency_code?: string; currency_minor_unit?: number }
}

export interface WooCartTotals {
  total_price?: string
  total_items?: string
  total_tax?: string
  total_shipping?: string
  currency_code?: string
  currency_minor_unit?: number
}

export interface WooCart {
  items?: WooCartItem[]
  items_count?: number
  totals?: WooCartTotals
  coupons?: { code?: string }[]
  cart_key?: string
}

/**
 * What the WordPress plugin prints on the order-received page. The browser never sees order data
 * otherwise, which is why the thank-you page needs a server-rendered payload.
 */
export interface WooOrderPayload {
  transaction_id: string
  value: number
  currency: string
  tax?: number
  shipping?: number
  coupon?: string
  item_count?: number
  unique_items?: number
  payment_type?: string
  shipping_tier?: string
  items?: {
    item_id?: string
    item_name?: string
    price?: number
    quantity?: number
    item_variant?: string
    item_category?: string
  }[]
}

export interface WooCustomerPayload {
  id?: string | number
  email?: string
  name?: string
  /** `guest`, `new` or `returning`, decided server-side from the order count. */
  type?: string
}

export interface WooGlobalPayload {
  store?: { id?: string; currency?: string; locale?: string }
  customer?: WooCustomerPayload
  order?: WooOrderPayload
}
