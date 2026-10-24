import {
  createTracker,
  type CommonPluginOptions,
  type PluginFootprint,
  type RumPlugin,
  type Tracker,
} from '@kyletaylored/datadog-rum-community-plugins'

export const PLUGIN_VERSION = '0.1.0'

/**
 * The platform events this adapter subscribes to, spelled the way the platform spells them.
 * Keep this list and `plugin.json`'s `footprint.events` in step; a test below asserts it.
 */
export const __NAME_CONST___EVENTS = ['replace_me'] as const

/**
 * What this adapter touches, rendered as a permissions screen in the gallery and printed in
 * debug mode. Declare everything: an undeclared global or RUM API fails the conformance suite.
 */
export const FOOTPRINT: PluginFootprint = {
  globals: ['window.replaceMe'],
  events: [...__NAME_CONST___EVENTS],
  // Leave empty unless the adapter writes its own keys. The core's purchase dedupe adds its key
  // automatically, so don't list `dd_rum_commerce_seen` here.
  storageKeys: [],
  rumApis: ['addAction', 'setGlobalContextProperty'],
  consentSource: null,
}

export interface __TITLE_CONST__PluginOptions extends CommonPluginOptions {
  // Adapter-specific options go here. Everything in CommonPluginOptions is already supported by
  // the core, and the gallery generates a settings form from `plugin.json`'s `options`.
}

/**
 * One-line description of what this adapter reads and what it sends.
 *
 * The adapter's only job is to map the platform's events onto the shared schema. The allow-list,
 * consent gate, PII filter, size caps, purchase dedupe, `beforeTrack` hook and debug log all
 * live in the core, so don't reimplement any of them here.
 */
export function __NAME_FN__Plugin(options: __TITLE_CONST__PluginOptions = {}): RumPlugin {
  return {
    name: '__NAME__',
    onInit({ initConfiguration, publicApi }) {
      const tracker = createTracker({
        platform: '__NAME__',
        version: PLUGIN_VERSION,
        publicApi,
        initConfiguration,
        options,
        footprint: FOOTPRINT,
      })

      // 1. Session-wide context, where the platform exposes it.
      // tracker.setStore({ id, currency, locale })
      // tracker.setCustomerType('returning')

      // 2. Identity, where the platform exposes a logged-in customer. Email and name are opt-in;
      //    pass them through and the core decides, rather than gating them here.
      // tracker.identify({ id: customerId, email, name })

      // 3. Subscribe to the platform's own events and map each one.
      //    Return `false` instead of subscribing when the adapter does not belong on this page,
      //    the way the official shopifyPlugin does off a checkout page.
      for (const event of __NAME_CONST___EVENTS) {
        void event
        // platform.subscribe(event, (payload) => handleEvent(tracker, payload))
      }

      tracker.logger.info(`subscribed to ${__NAME_CONST___EVENTS.length} platform events`)
    },
  }
}

/** Map one platform payload onto the schema. Send numbers as numbers, never strings. */
function handleEvent(tracker: Tracker, payload: unknown): void {
  void payload
  // tracker.track('add_to_cart', { value: 28, currency: 'USD', items: [...] })
  tracker.logger.dropped('replace_me', 'no schema event for this platform event')
}

export default __NAME_FN__Plugin
