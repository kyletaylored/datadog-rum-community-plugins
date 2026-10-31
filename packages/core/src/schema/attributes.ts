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

/**
 * Engagement attributes.
 *
 * Note what is deliberately absent: GA4's `link_url`. A href can carry tokens, session IDs or an
 * email in its query string, and `mailto:`/`tel:` hrefs *are* the personal data. This schema sends
 * the domain and the path only, with the query and fragment dropped, and reduces a mailto or tel
 * link to `link_type` — the fact of the click, never the address.
 */
export const ENGAGEMENT_ATTRIBUTES: Record<string, AttributeSpec> = {
  percent_scrolled: {
    type: 'integer',
    origin: 'ga4',
    description: 'How far down the page the visitor reached, as a threshold: 25, 50, 75 or 90.',
    example: 75,
  },
  link_domain: {
    type: 'string',
    origin: 'extension',
    description: 'Host of the clicked link. Replaces GA4 link_url, which can carry PII in its query string.',
    example: 'docs.example.com',
  },
  link_path: {
    type: 'string',
    origin: 'extension',
    description: 'Path of the clicked link, with the query string and fragment removed.',
    example: '/pricing',
  },
  link_text: {
    type: 'string',
    origin: 'ga4',
    description: 'Visible text of the link, truncated.',
    example: 'Download the report',
  },
  link_type: {
    type: 'string',
    origin: 'extension',
    description:
      'outbound, email or phone. For email and phone the address itself is never sent — only that a click happened.',
    example: 'outbound',
  },
  outbound: { type: 'boolean', origin: 'ga4', description: 'True when the link leaves this host.', example: true },
  file_name: { type: 'string', origin: 'ga4', description: 'File name from the link path.', example: 'q3-report.pdf' },
  file_extension: { type: 'string', origin: 'ga4', description: 'Extension, lower case, no dot.', example: 'pdf' },
  video_title: { type: 'string', origin: 'ga4', description: 'Video title or accessible label, truncated.', example: 'Product tour' },
  video_provider: { type: 'string', origin: 'ga4', description: 'html5, youtube or vimeo.', example: 'html5' },
  video_duration: { type: 'integer', origin: 'ga4', description: 'Length in seconds.', example: 212 },
  video_percent: { type: 'integer', origin: 'ga4', description: 'Progress threshold reached: 10, 25, 50 or 75.', example: 50 },
  form_id: { type: 'string', origin: 'extension', description: 'Form id or name attribute. Never its field values.', example: 'newsletter' },
  form_name: { type: 'string', origin: 'extension', description: 'Accessible name of the form, truncated.', example: 'Newsletter signup' },
  form_destination: {
    type: 'string',
    origin: 'ga4',
    description: 'Host the form posts to, not the full action URL.',
    example: 'hooks.example.com',
  },
  engagement_time_msec: {
    type: 'integer',
    origin: 'ga4',
    description: 'Time the visitor was actively engaged before the event, in milliseconds.',
    example: 14200,
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

/**
 * Learning attributes, for course platforms (LearnDash first). GA4 has no learning events, so
 * these are extensions, named the way GA4 names things.
 *
 * Course and lesson titles are content, not personal data, and are sent. Answers never are: a
 * quiz reports its score and whether it was passed, not what the learner wrote. The learner is
 * identified only through `setUser`, by the platform's user ID.
 */
export const LEARNING_ATTRIBUTES: Record<string, AttributeSpec> = {
  course_id: { type: 'string', origin: 'extension', description: 'The platform ID of the course.', example: '1204' },
  course_name: { type: 'string', origin: 'extension', description: 'Course title, truncated.', example: 'Incident response basics' },
  lesson_id: { type: 'string', origin: 'extension', description: 'The platform ID of the lesson or topic.', example: '1311' },
  lesson_name: { type: 'string', origin: 'extension', description: 'Lesson or topic title, truncated.', example: 'Writing a status update' },
  step_type: { type: 'string', origin: 'extension', description: 'lesson or topic: which level of the course the step is.', example: 'lesson' },
  quiz_id: { type: 'string', origin: 'extension', description: 'The platform ID of the quiz.', example: '1402' },
  quiz_name: { type: 'string', origin: 'extension', description: 'Quiz title, truncated.', example: 'Status updates check' },
  score: { type: 'number', origin: 'ga4', description: 'Points scored, as GA4 post_score sends it. Never the answers.', example: 8 },
  score_max: { type: 'number', origin: 'extension', description: 'Points available, so score can be read as a share.', example: 10 },
  passed: { type: 'boolean', origin: 'extension', description: 'Whether the attempt met the pass mark.', example: true },
  attempt: { type: 'integer', origin: 'extension', description: 'Which attempt at the quiz this was, from 1.', example: 1 },
  progress_percent: { type: 'integer', origin: 'extension', description: "The learner's progress through the course after the step, 0-100.", example: 40 },
}

export const SUPPORT_ATTRIBUTES: Record<string, AttributeSpec> = {
  provider: { type: 'string', origin: 'extension', description: 'Chat provider name.', example: 'intercom' },
}
