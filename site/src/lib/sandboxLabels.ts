/**
 * Plain-language labels for the recorded fixtures.
 *
 * The fixtures are named after the platform event, which is right for a test and wrong for a
 * visitor: nobody reads `wc-blocks_added_to_cart` as "a shopper added something". The mapping is
 * presentation only — the payloads are still the ones the test suite replays.
 */
export const STEP_LABELS: Record<string, string> = {
  // Shopify Web Pixels
  product_viewed: 'Looks at a t-shirt',
  collection_viewed: 'Browses the sale collection',
  product_added_to_cart: 'Adds 2 t-shirts to the cart',
  product_removed_from_cart: 'Removes the cap',
  cart_viewed: 'Opens the cart',
  checkout_started: 'Starts checkout',
  checkout_shipping_info_submitted: 'Chooses Ground shipping',
  payment_info_submitted: 'Enters payment details',
  checkout_completed: 'Places the order',
  search_submitted: 'Searches for "red tee medium"',

  // WooCommerce DOM events
  'wc-blocks_added_to_cart': 'Adds 2 t-shirts to the cart',
  'wc-blocks_removed_from_cart': 'Removes the cap',
  'wc-blocks_product_list_rendered': 'Browses a category page',
  added_to_cart: 'Adds socks (classic theme)',
  removed_from_cart: 'Removes an item (classic theme)',
  order_received: 'Lands on the thank-you page',

  // Engagement: the fixture name already reads as a shopper action, so these fall through to it.
}

/** OneTrust fixtures all share one event, so they are labelled by fixture name. */
export const CONSENT_LABELS: Record<string, string> = {
  'banner not yet answered': 'Banner appears, not answered',
  'strictly necessary only': 'Rejects everything optional',
  'performance accepted': 'Accepts analytics cookies',
  'all categories accepted': 'Accepts all cookies',
  'consent withdrawn': 'Later turns analytics off',
}

/** The second `checkout_completed` fixture is a reload, not a second order. */
export function labelFor(fixtureName: string, event: string, seenBefore: boolean): string {
  if (CONSENT_LABELS[fixtureName]) return CONSENT_LABELS[fixtureName]!
  if (seenBefore && (event === 'checkout_completed' || event === 'order_received')) {
    return 'Reloads the thank-you page'
  }
  return STEP_LABELS[event] ?? fixtureName
}
