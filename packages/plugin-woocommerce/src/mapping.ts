import { count, money, sanitizeItems } from '@kyletaylored/datadog-rum-community-plugins'
import type { WooCart, WooCartItem, WooCartTotals, WooOrderPayload } from './types.js'

/**
 * Woo's Store API sends money as integer minor units with an exponent
 * (`{ price: '2499', currency_minor_unit: 2 }` → 24.99). Theme events sometimes send a decimal
 * string instead, so a value with no exponent is read as-is.
 */
export function wooMoney(value: unknown, minorUnit?: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const raw = typeof value === 'string' ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  if (minorUnit === undefined) return money(raw)
  return money(raw / 10 ** minorUnit)
}

export function cartCurrency(cart: WooCart | undefined): string | undefined {
  return cart?.totals?.currency_code ?? cart?.items?.[0]?.prices?.currency_code
}

/** GA4 `items[]` from Woo cart items. Variations collapse into `item_variant`. */
export function toItems(items: WooCartItem[] | undefined): Record<string, unknown>[] | undefined {
  if (!items || items.length === 0) return undefined
  return sanitizeItems(
    items.map((item) => ({
      item_id: item.sku ?? (item.id === undefined ? undefined : String(item.id)),
      item_name: item.name,
      price: wooMoney(item.prices?.price, item.prices?.currency_minor_unit),
      quantity: item.quantity,
      item_variant: item.variation?.map((v) => v.value).filter(Boolean).join(' / ') || undefined,
      item_category: item.categories?.[0]?.name,
    })),
  )
}

/** Sum of quantities, and the number of distinct lines. */
export function itemCounts(items: WooCartItem[] | undefined): { item_count?: number; unique_items?: number } {
  if (!items || items.length === 0) return {}
  const total = items.reduce((sum, item) => sum + (count(item.quantity) ?? 0), 0)
  return { item_count: total, unique_items: items.length }
}

export function cartValue(totals: WooCartTotals | undefined): number | undefined {
  return wooMoney(totals?.total_price, totals?.currency_minor_unit)
}

/** Value of just the items a cart event touched, rather than the whole cart. */
export function lineValue(item: WooCartItem | undefined, quantity?: number): number | undefined {
  if (!item) return undefined
  const lineTotal = wooMoney(item.totals?.line_total, item.totals?.currency_minor_unit)
  if (lineTotal !== undefined && quantity === undefined) return lineTotal
  const unit = wooMoney(item.prices?.price, item.prices?.currency_minor_unit)
  if (unit === undefined) return lineTotal
  return money(unit * (count(quantity) ?? count(item.quantity) ?? 1))
}

/** The order-received payload, mapped onto the `commerce.purchase` attributes. */
export function toPurchase(order: WooOrderPayload): Record<string, unknown> {
  return {
    transaction_id: order.transaction_id,
    value: money(order.value),
    currency: order.currency,
    tax: money(order.tax),
    shipping: money(order.shipping),
    coupon: order.coupon,
    payment_type: order.payment_type,
    shipping_tier: order.shipping_tier,
    item_count: count(order.item_count),
    unique_items: count(order.unique_items),
    items: order.items,
  }
}
