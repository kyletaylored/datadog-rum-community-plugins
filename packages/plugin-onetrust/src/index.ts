import {
  GLOBAL_CONTEXT_KEYS,
  createConsentGate,
  createLogger,
  type RumPlugin,
} from '@kyletaylored/datadog-rum-community-plugins'

export const PLUGIN_VERSION = '0.2.0'

/** Analytics/performance cookies in OneTrust's default category set. */
export const DEFAULT_CATEGORY = 'C0002'

export interface OneTrustPluginOptions {
  /**
   * The OneTrust category that must be active before RUM may collect. `C0002` (Performance) is
   * the default; sites that put analytics elsewhere pass their own, or several.
   */
  category?: string | string[]
  /**
   * Report the visitor's accepted categories as the `consent.categories` global context property.
   * Only sessions that opted in are visible at all, so this describes opted-in sessions, never
   * the opt-in rate.
   */
  reportCategories?: boolean
  /** How long to wait for the OneTrust banner script before giving up, in milliseconds. */
  timeoutMs?: number
  /** Log consent transitions to the console. */
  debug?: boolean
}

interface OptanonApi {
  OnConsentChanged?: (callback: (event: { detail?: unknown }) => void) => void
}

interface OneTrustWindow {
  OnetrustActiveGroups?: string
  Optanon?: OptanonApi
  OptanonWrapper?: () => void
  OneTrust?: unknown
  addEventListener: Window['addEventListener']
  removeEventListener: Window['removeEventListener']
  setTimeout: Window['setTimeout'];
  clearTimeout: Window['clearTimeout']
}

/**
 * `OnetrustActiveGroups` is a comma-delimited string with leading and trailing commas,
 * e.g. `,C0001,C0002,`. Empty segments are dropped.
 */
export function parseActiveGroups(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group !== '')
}

/** True when every required category appears in the visitor's active groups. */
export function hasConsent(active: string[], required: string[]): boolean {
  return required.length > 0 && required.every((category) => active.includes(category))
}

/**
 * Holds Datadog RUM until the visitor accepts OneTrust's analytics category.
 *
 * `onInit` sets `trackingConsent = 'not-granted'` before the SDK starts, the same way the
 * official `shopifyPlugin` rewrites init options, so nothing is collected on a page where the
 * banner has not been answered. It calls `setTrackingConsent('granted')` only once the required
 * category is active, and `'not-granted'` again if the visitor later withdraws.
 *
 * Put this first in `plugins: [...]`, before any adapter that sends events.
 *
 * OneTrust's callback names (`OptanonWrapper`, `Optanon.OnConsentChanged`, the
 * `OneTrustGroupsUpdated` event) are not all covered by public vendor docs; this adapter listens
 * on all of them and falls back to reading `OnetrustActiveGroups` directly, so one of them
 * firing is enough.
 */
export function oneTrustPlugin(options: OneTrustPluginOptions = {}): RumPlugin {
  const required = typeof options.category === 'string'
    ? [options.category]
    : (options.category ?? [DEFAULT_CATEGORY])
  const reportCategories = options.reportCategories ?? true
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    name: 'onetrust',
    onInit({ initConfiguration, publicApi }) {
      const logger = createLogger('onetrust', options.debug === true)
      const win = globalThis as unknown as OneTrustWindow

      if (typeof win.addEventListener !== 'function') {
        logger.warn('no window to listen on, leaving consent to the host page')
        return false
      }

      const gate = createConsentGate({ mode: 'auto', publicApi, initConfiguration })
      logger.info(`holding RUM until ${required.join(' + ')} is active`)

      let settled = false

      const evaluate = (source: string): void => {
        const active = parseActiveGroups(win.OnetrustActiveGroups)
        if (active.length === 0 && !settled) {
          logger.info(`${source}: no active groups yet`)
          return
        }

        if (hasConsent(active, required)) {
          settled = true
          logger.info(`${source}: granted`, active)
          gate.grant(reportCategories ? active : undefined)
        } else {
          settled = true
          logger.info(`${source}: not granted`, active)
          if (reportCategories && active.length > 0) {
            publicApi.setGlobalContextProperty(GLOBAL_CONTEXT_KEYS.consentCategories, active.slice().sort())
          }
          gate.deny()
        }
      }

      // 1. Already answered before RUM loaded: the banner sets the global synchronously.
      evaluate('initial read')

      // 2. OneTrust dispatches this on the window each time groups change.
      win.addEventListener('OneTrustGroupsUpdated', () => evaluate('OneTrustGroupsUpdated'))

      // 3. `OptanonWrapper` is a hook the page defines and OneTrust calls. Chain any existing one
      //    rather than replacing it, so a site's own wrapper keeps working.
      const existingWrapper = win.OptanonWrapper
      win.OptanonWrapper = function patchedOptanonWrapper(this: unknown) {
        try {
          existingWrapper?.call(this)
        } catch (error) {
          logger.warn('the page’s own OptanonWrapper threw', error)
        }
        // The newer event API only exists once the banner script has run.
        win.Optanon?.OnConsentChanged?.(() => evaluate('OnConsentChanged'))
        evaluate('OptanonWrapper')
      }

      // 4. If the banner never loads, leave consent not-granted rather than failing open.
      const timer = win.setTimeout(() => {
        if (!settled) {
          logger.warn(`OneTrust did not report consent within ${timeoutMs}ms; RUM stays held`)
        }
      }, timeoutMs)

      if (typeof win.clearTimeout === 'function') {
        win.addEventListener('pagehide', () => win.clearTimeout(timer), { once: true })
      }
    },
  }
}

export default oneTrustPlugin
