import { count, money, sanitizeItems } from '@kyletaylored/datadog-rum-community-plugins'
import type {
  ShopifyCartLine,
  ShopifyCheckout,
  ShopifyCheckoutLineItem,
  ShopifyMoney,
  ShopifyProductVariant,
} from './types.js'

export function amount(value: ShopifyMoney | undefined): number | undefined {
  return money(value?.amount)
}

export function currencyOf(...candidates: (ShopifyMoney | string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
    if (candidate && typeof candidate === 'object' && candidate.currencyCode) return candidate.currencyCode
  }
  return undefined
}

function variantToItem(variant: ShopifyProductVariant | undefined, quantity?: number): Record<string, unknown> {
  return {
    item_id: variant?.sku ?? variant?.id,
    item_name: variant?.product?.title ?? variant?.title,
    price: amount(variant?.price),
    quantity: count(quantity),
    // Shopify names the default variant "Default Title"; that is noise, not a variant.
    item_variant: variant?.title && variant.title !== 'Default Title' ? variant.title : undefined,
    item_category: variant?.product?.type,
  }
}

export function itemsFromVariants(
  variants: (ShopifyProductVariant | undefined)[],
  quantity?: number,
): Record<string, unknown>[] | undefined {
  return sanitizeItems(variants.map((variant) => variantToItem(variant, quantity ?? 1)))
}

export function itemsFromCartLines(lines: ShopifyCartLine[] | undefined): Record<string, unknown>[] | undefined {
  if (!lines?.length) return undefined
  return sanitizeItems(lines.map((line) => variantToItem(line.merchandise, line.quantity)))
}

export function itemsFromLineItems(
  lineItems: ShopifyCheckoutLineItem[] | undefined,
): Record<string, unknown>[] | undefined {
  if (!lineItems?.length) return undefined
  return sanitizeItems(
    lineItems.map((lineItem) => ({
      ...variantToItem(lineItem.variant, lineItem.quantity),
      item_name: lineItem.variant?.product?.title ?? lineItem.title,
    })),
  )
}

export function lineItemCounts(
  lineItems: ShopifyCheckoutLineItem[] | ShopifyCartLine[] | undefined,
): { item_count?: number; unique_items?: number } {
  if (!lineItems?.length) return {}
  const total = lineItems.reduce((sum, line) => sum + (count(line.quantity) ?? 0), 0)
  return { item_count: total, unique_items: lineItems.length }
}

/** First discount title, which is what GA4's `coupon` holds. */
export function couponOf(checkout: ShopifyCheckout | undefined): string | undefined {
  return checkout?.discountApplications?.find((discount) => discount.title)?.title
}

/**
 * Payment method name only. Shopify's `transactions[]` carries a gateway name, never card data,
 * and the core's filter strips card fields regardless.
 */
export function paymentTypeOf(checkout: ShopifyCheckout | undefined): string | undefined {
  const transaction = checkout?.transactions?.[0]
  return transaction?.paymentMethod ?? transaction?.gateway
}

export function shippingTierOf(checkout: ShopifyCheckout | undefined): string | undefined {
  return checkout?.delivery?.selectedDeliveryOptions?.[0]?.title ?? checkout?.shippingLine?.title
}

/**
 * The order identifier to deduplicate on. Shopify's `order.id` is the stable one; the checkout
 * token is the fallback on stores where `order` is not populated on `checkout_completed`.
 */
export function transactionIdOf(checkout: ShopifyCheckout | undefined): string | undefined {
  const id = checkout?.order?.id
  if (id !== undefined && id !== null && String(id) !== '') return String(id)
  return checkout?.token ? String(checkout.token) : undefined
}

/** `checkout_completed` → the `commerce.purchase` attributes. */
export function toPurchase(checkout: ShopifyCheckout): Record<string, unknown> {
  return {
    transaction_id: transactionIdOf(checkout),
    ...checkoutTotals(checkout),
    tax: amount(checkout.totalTax),
    shipping: amount(checkout.shippingLine?.price),
    coupon: couponOf(checkout),
    payment_type: paymentTypeOf(checkout),
    shipping_tier: shippingTierOf(checkout),
    items: itemsFromLineItems(checkout.lineItems),
    ...lineItemCounts(checkout.lineItems),
  }
}

/**
 * Value and currency as every checkout step reports them. Each funnel step builds on this and
 * adds only what is specific to it, so the pair is derived in one place.
 */
export function checkoutTotals(checkout: ShopifyCheckout | undefined): Record<string, unknown> {
  return {
    value: amount(checkout?.totalPrice),
    currency: currencyOf(checkout?.totalPrice, checkout?.currencyCode),
  }
}

/** Shared attributes for `begin_checkout`, which reports the whole cart. */
export function checkoutAttributes(checkout: ShopifyCheckout | undefined): Record<string, unknown> {
  return {
    ...checkoutTotals(checkout),
    coupon: couponOf(checkout),
    items: itemsFromLineItems(checkout?.lineItems),
    ...lineItemCounts(checkout?.lineItems),
  }
}
