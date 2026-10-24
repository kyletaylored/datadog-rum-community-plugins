/**
 * `@kyletaylored/datadog-rum-community-plugins`
 *
 * Shared core for the community RUM plugins: the versioned event schemas plus the safety layers
 * every adapter inherits (consent gate, PII filter, size caps, purchase dedupe, debug log).
 *
 * A personal community project. Not provided or supported by Datadog.
 */

export { createTracker } from './runtime/tracker.js'
export type {
  AccountInput,
  IdentityInput,
  StoreContext,
  Tracker,
  TrackerConfig,
} from './runtime/tracker.js'

export { createConsentGate } from './runtime/consentGate.js'
export type { ConsentGate, ConsentGateOptions } from './runtime/consentGate.js'

export { DEDUPE_STORAGE_KEY, DEDUPE_TTL_MS, createDedupe } from './runtime/dedupe.js'
export type { Dedupe, DedupeOptions } from './runtime/dedupe.js'

export {
  MAX_DEPTH,
  MAX_ITEMS,
  MAX_STRING_LENGTH,
  count,
  isBlockedKey,
  money,
  sanitizeContext,
  sanitizeItems,
  text,
} from './runtime/sanitize.js'

export { createLogger } from './runtime/logger.js'
export type { Logger } from './runtime/logger.js'

export * from './schema/index.js'
export * from './types.js'
export type { PluginManifest } from './manifest.js'
