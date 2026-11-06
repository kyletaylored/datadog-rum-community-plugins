/**
 * The slice of the Shopify Web Pixels API this adapter reads.
 * @see https://shopify.dev/docs/api/web-pixels-api/standard-events
 */

export interface ShopifyMoney {
  amount?: number
  currencyCode?: string
}

export interface ShopifyProductVariant {
  id?: string
  sku?: string
  title?: string
  price?: ShopifyMoney
  product?: { id?: string; title?: string; type?: string; vendor?: string }
}

export interface ShopifyCartLine {
  quantity?: number
  cost?: { totalAmount?: ShopifyMoney }
  merchandise?: ShopifyProductVariant
}

export interface ShopifyCheckoutLineItem {
  id?: string
  title?: string
  quantity?: number
  variant?: ShopifyProductVariant
  finalLinePrice?: ShopifyMoney
}

export interface ShopifyCheckout {
  order?: { id?: string; customer?: { id?: string | number } }
  token?: string
  currencyCode?: string
  totalPrice?: ShopifyMoney
  subtotalPrice?: ShopifyMoney
  totalTax?: ShopifyMoney
  shippingLine?: { price?: ShopifyMoney; title?: string }
  discountApplications?: { title?: string; type?: string }[]
  lineItems?: ShopifyCheckoutLineItem[]
  /** Present on `payment_info_submitted`. A method name, never card data. */
  transactions?: { gateway?: string; paymentMethod?: string }[]
  delivery?: { selectedDeliveryOptions?: { title?: string }[] }
  email?: string
  phone?: string
}

export interface ShopifyEvent {
  name: string
  id?: string
  timestamp?: string
  context?: {
    document?: { location?: { href?: string; search?: string } }
    window?: { location?: { href?: string } }
  }
  data?: {
    checkout?: ShopifyCheckout
    cartLine?: ShopifyCartLine
    productVariant?: ShopifyProductVariant
    collection?: { id?: string; title?: string; productVariants?: ShopifyProductVariant[] }
    cart?: { id?: string; cost?: { totalAmount?: ShopifyMoney }; totalQuantity?: number; lines?: ShopifyCartLine[] }
    searchResult?: { query?: string }
    customer?: { id?: string | number; email?: string; firstName?: string; lastName?: string; ordersCount?: number }
  }
}

/** The sandbox `analytics` global a custom pixel receives. */
export interface ShopifyAnalyticsApi {
  subscribe: (event: string, callback: (event: ShopifyEvent) => void) => void
}

/** `window.Shopify` on storefront (non-checkout) pages. */
export interface ShopifyStorefrontGlobal {
  shop?: string
  currency?: { active?: string }
  locale?: string
  /** The storefront's root path, `/fr/` on a translated store. */
  routes?: { root?: string }
  customerPrivacy?: {
    analyticsProcessingAllowed?: () => boolean
    currentVisitorConsent?: () => Record<string, string>
  }
}

/** One line of the Ajax Cart API's `cart.js`. Money is in minor units. Only these fields are read. */
export interface AjaxCartLine {
  id?: number
  key?: string
  variant_id?: number
  quantity?: number
  sku?: string | null
  title?: string
  product_title?: string
  variant_title?: string | null
  product_type?: string
  price?: number
  final_price?: number
}

/**
 * The Ajax Cart API's `cart.js`. `attributes`, `note` and line `properties` exist too and are
 * deliberately absent here: on real stores they carry the shopper's email and app tokens.
 */
export interface AjaxCart {
  token?: string
  currency?: string
  total_price?: number
  item_count?: number
  items?: AjaxCartLine[]
}

/** A product in `ShopifyAnalytics.meta`, which every Online Store theme prints. Money in minor units. */
export interface StorefrontMetaProduct {
  id?: number
  vendor?: string
  type?: string
  variants?: { id?: number; price?: number; name?: string; public_title?: string | null; sku?: string | null }[]
}

export interface StorefrontMeta {
  page?: { pageType?: string; customerId?: number | string | null }
  product?: StorefrontMetaProduct
  products?: StorefrontMetaProduct[]
}
