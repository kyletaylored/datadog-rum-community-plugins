import { ITEM_FIELDS } from '../schema/keys.js'

/** Caps from the PRD's privacy rules. Enforced for every adapter, not per adapter. */
export const MAX_ITEMS = 20
export const MAX_STRING_LENGTH = 256
export const MAX_DEPTH = 4

/**
 * Keys that are never sent, whatever a platform payload contains. Matched case-insensitively
 * against a normalized key (non-alphanumerics removed), so `card_number`, `cardNumber` and
 * `card-number` all hit the same entry.
 */
const BLOCKED_KEY_PATTERNS: RegExp[] = [
  // Payment data: stripped even when the platform includes it.
  /^(card|credit|debit)?(number|num|no)$/,
  /card(number|num|no|holder|brand|bin|last4|first6|expiry|expmonth|expyear)/,
  /^(cvv|cvc|cvv2|csc|securitycode|pin)$/,
  /^(pan|iban|bic|swift|routingnumber|accountnumber|sortcode)$/,
  /(billing|shipping)?address(line|1|2)?$/,
  /^(street|streetaddress|addressline1|addressline2|postalcode|postcode|zip|zipcode)$/,
  // Direct identifiers: opt-in only, added explicitly by the identity path, never carried
  // through on action attributes.
  /^(email|emailaddress|mail)$/,
  /^(phone|phonenumber|tel|telephone|mobile)$/,
  /^(ssn|taxid|nationalid|passport|driverslicense)$/,
  /^password$/,
  /^(firstname|lastname|fullname|surname|givenname|familyname)$/,
  // Free text that can carry anything a shopper typed.
  /^(searchterm|searchquery|query|q)$/,
  /^(note|notes|comment|comments|message)$/,
]

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** True when an attribute key must never leave the browser. */
export function isBlockedKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return BLOCKED_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Every key anywhere in a payload that `isBlockedKey` refuses, in first-seen order. Used to say
 * what was stripped (the sandbox feed, the plugin pages), never to decide what is sent.
 */
export function blockedKeys(payload: unknown, found: string[] = [], depth = 0): string[] {
  if (!payload || typeof payload !== 'object' || depth > MAX_DEPTH + 2) return found
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (isBlockedKey(key)) {
      if (!found.includes(key)) found.push(key)
    } else if (value && typeof value === 'object') {
      blockedKeys(value, found, depth + 1)
    }
  }
  return found
}

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value
}

/** Round currency amounts to cents so floating-point noise doesn't reach a distribution metric. */
export function money(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.round(n * 100) / 100
}

/** Coerce to a non-negative integer, for counts and lengths. */
export function count(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return Math.max(0, Math.round(n))
}

/** Coerce to a truncated string, dropping empty values so they don't clutter the attributes. */
export function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : truncate(trimmed)
}

/** Keep only GA4 item fields, in GA4 types, capped at `MAX_ITEMS` entries. */
export function sanitizeItems(input: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(input)) return undefined
  const items: Record<string, unknown>[] = []
  for (const raw of input.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') continue
    const source = raw as Record<string, unknown>
    const item: Record<string, unknown> = {}
    for (const field of ITEM_FIELDS) {
      const value = source[field]
      if (value === undefined || value === null) continue
      if (field === 'price') {
        const price = money(value)
        if (price !== undefined) item[field] = price
      } else if (field === 'quantity') {
        const quantity = count(value)
        if (quantity !== undefined) item[field] = quantity
      } else {
        const str = text(value)
        if (str !== undefined) item[field] = str
      }
    }
    if (Object.keys(item).length > 0) items.push(item)
  }
  return items.length > 0 ? items : undefined
}

/**
 * Strip blocked keys, truncate strings, cap arrays and drop anything deeper than `MAX_DEPTH`.
 * Runs on every event in the core so an adapter cannot leak by forgetting to filter.
 */
export function sanitizeContext(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  if (depth > MAX_DEPTH) return output

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (isBlockedKey(key)) continue

    if (key === 'items') {
      const items = sanitizeItems(value)
      if (items) output[key] = items
      continue
    }

    if (typeof value === 'string') {
      const str = text(value)
      if (str !== undefined) output[key] = str
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) output[key] = value
    } else if (typeof value === 'boolean') {
      output[key] = value
    } else if (Array.isArray(value)) {
      const list = value
        .slice(0, MAX_ITEMS)
        .map((entry) =>
          entry && typeof entry === 'object'
            ? sanitizeContext(entry as Record<string, unknown>, depth + 1)
            : typeof entry === 'string'
              ? truncate(entry)
              : entry,
        )
        .filter((entry) => entry !== undefined && entry !== null)
      if (list.length > 0) output[key] = list
    } else if (typeof value === 'object') {
      const nested = sanitizeContext(value as Record<string, unknown>, depth + 1)
      if (Object.keys(nested).length > 0) output[key] = nested
    }
  }

  return output
}
