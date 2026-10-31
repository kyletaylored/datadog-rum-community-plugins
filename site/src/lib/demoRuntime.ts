/**
 * Entry for `public/demos/_shared/runtime.js`, built by `scripts/build-demos.mjs`.
 *
 * The demo sites are static pages, so they cannot import TypeScript. This bundles the sandbox's
 * own recorder and the core's key filter onto one global, which `bridge.js` reads. The demos then
 * run the same recorder the sandbox documents, not a copy of it.
 */
import { DEDUPE_STORAGE_KEY, blockedKeys } from '@kyletaylored/datadog-rum-community-plugins'
import { MESSAGE, captureDebugLog, clearDedupe, createRecorder } from './sandbox'

export { DEDUPE_STORAGE_KEY, MESSAGE, blockedKeys, captureDebugLog, clearDedupe, createRecorder }
