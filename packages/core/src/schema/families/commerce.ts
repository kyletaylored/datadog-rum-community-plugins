import type { RuntimeFamily } from './types.js'

export const COMMERCE_FAMILY: RuntimeFamily = {
  name: 'commerce',
  prefix: 'commerce.',
  events: [
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
}
