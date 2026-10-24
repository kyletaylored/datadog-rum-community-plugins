/**
 * The sandbox runtime: it instantiates the **real** adapters from the workspace packages and runs
 * them against a recording `publicApi`.
 *
 * It never initializes RUM and never asks for an application ID or client token — the site must
 * not handle credentials. That is not only a safety rule, it is what makes the sandbox useful:
 * recording the calls an adapter *would* make is the only way to show the consent gate holding
 * events back, the purchase dedupe refusing a second order, and card data being stripped. A live
 * RUM demo could show none of those, because the whole point is that nothing is sent.
 */
import { oneTrustPlugin } from '@kyletaylored/datadog-rum-plugin-onetrust'
import { shopifyPlugin } from '@kyletaylored/datadog-rum-plugin-shopify'
import { wooCommercePlugin } from '@kyletaylored/datadog-rum-plugin-woocommerce'
import { DEDUPE_STORAGE_KEY } from '@kyletaylored/datadog-rum-community-plugins'
import type {
  CommonPluginOptions,
  RumInitConfigurationLike,
  RumPlugin,
  RumPublicApi,
} from '@kyletaylored/datadog-rum-community-plugins'

export interface SandboxFixture {
  name: string
  description?: string
  event: string
  payload: unknown
  file: string
}

/** One recorded call, as the log renders it. */
export interface SandboxCall {
  api: string
  /** Action name, context key, or consent state — whatever identifies the call at a glance. */
  label?: string
  detail?: unknown
  /** Set when the core refused to send something, with the reason. */
  blocked?: string
}

export interface SandboxOptions extends CommonPluginOptions {
  category?: string
  /**
   * Simulates `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`. `absent` is the pixel
   * sandbox, where there is no Customer Privacy API because the Pixel Manager has already applied
   * the merchant's categories before the pixel runs.
   */
  shopifyPrivacy?: 'absent' | 'allowed' | 'denied'
}

export type SandboxAdapter = 'shopify' | 'woocommerce' | 'onetrust'

export interface SandboxSession {
  /** Hand one recorded payload to the platform double the adapter subscribed to. */
  emit: (fixture: SandboxFixture) => void
  initConfiguration: RumInitConfigurationLike
  /** False when the adapter opted out of this page, the way shopifyPlugin does off checkout. */
  initialized: boolean
  /** Stop forwarding the adapter's debug output. */
  dispose: () => void
}

/**
 * Forwards the core's own debug log into the sandbox.
 *
 * The adapters run with `debug: true`, and the core reports every refusal through
 * `logger.dropped(...)` on `console.log`. Reading that channel rather than inventing one means the
 * sandbox shows exactly what a merchant sees when they follow the docs and turn debug on — and it
 * is the only way to surface a *refusal*, which by definition produces no RUM call. Without it the
 * purchase dedupe looks like nothing happening.
 */
function captureDebugLog(
  platform: string,
  onCall: (call: SandboxCall) => void,
  isActive: () => boolean,
): () => void {
  const tag = `[dd-rum:${platform}]`
  const original = { log: console.log, warn: console.warn }

  const forward = (level: 'log' | 'warn', args: unknown[]) => {
    original[level].apply(console, args as never)
    if (!isActive()) return
    if (typeof args[0] !== 'string' || !args[0].startsWith(tag)) return

    const message = args[0].slice(tag.length).trim()
    const rest = args.slice(1)

    if (message === 'dropped') {
      // logger.dropped prints: tag, 'dropped', <action>, '(<reason>)'
      const action = String(rest[0] ?? '')
      const reason = String(rest[1] ?? '').replace(/^\(|\)$/g, '')
      onCall({ api: 'not sent', label: action, blocked: reason })
      return
    }
    if (message === 'addAction' || message === 'setUser' || message === 'setAccount') {
      // Already recorded through the publicApi itself; don't double-report it.
      return
    }
    onCall({ api: 'debug', label: message, detail: rest.length === 1 ? rest[0] : rest.length ? rest : undefined })
  }

  console.log = (...args: unknown[]) => forward('log', args)
  console.warn = (...args: unknown[]) => forward('warn', args)

  return () => {
    console.log = original.log
    console.warn = original.warn
  }
}

/** Records instead of sending, and reports each call as it happens so the log can stream. */
function createRecorder(onCall: (call: SandboxCall) => void, isActive: () => boolean): RumPublicApi {
  const report = (call: SandboxCall) => {
    // A superseded session must stay silent. Adapters subscribe for the life of the page — the
    // OneTrust one registers a window listener and never removes it, which is correct on a real
    // site — so after a reset the previous adapter is still listening and would report twice.
    if (isActive()) onCall(call)
  }
  return {
    addAction: (name, context) => report({ api: 'addAction', label: name, detail: context ?? {} }),
    setUser: (user) => report({ api: 'setUser', detail: user }),
    setAccount: (account) => report({ api: 'setAccount', detail: account }),
    clearUser: () => report({ api: 'clearUser' }),
    clearAccount: () => report({ api: 'clearAccount' }),
    setGlobalContextProperty: (key, value) =>
      report({ api: 'setGlobalContextProperty', label: key, detail: value }),
    addError: (error, context) => report({ api: 'addError', detail: { error, context } }),
    startView: (view) => report({ api: 'startView', detail: view }),
    setTrackingConsent: (consent) => report({ api: 'setTrackingConsent', label: consent }),
  }
}

/** The Web Pixel sandbox's `analytics` global, as a custom pixel receives it. */
function shopifyAnalyticsDouble() {
  const handlers = new Map<string, ((event: unknown) => void)[]>()
  return {
    api: {
      subscribe(event: string, callback: (event: never) => void) {
        const list = handlers.get(event) ?? []
        list.push(callback as (event: unknown) => void)
        handlers.set(event, list)
      },
    },
    emit(fixture: SandboxFixture) {
      for (const handler of handlers.get(fixture.event) ?? []) handler(fixture.payload)
    },
  }
}

/**
 * Clears the core's purchase-dedupe entry. The sandbox resets between runs so a demo does not
 * look broken on a second visit — but "fire the order twice" deliberately does not reset, because
 * that is the behaviour being demonstrated.
 */
export function clearDedupe(): void {
  try {
    localStorage.removeItem(DEDUPE_STORAGE_KEY)
  } catch {
    // Storage blocked: the core's in-memory fallback still applies for this page.
  }
}

export function startSession(
  adapter: SandboxAdapter,
  options: SandboxOptions,
  onCall: (call: SandboxCall) => void,
): SandboxSession {
  let active = true
  const isActive = () => active
  const publicApi = createRecorder(onCall, isActive)
  const initConfiguration: RumInitConfigurationLike = {}

  let plugin: RumPlugin
  let emit: (fixture: SandboxFixture) => void

  // Debug on, so the core reports refusals; captureDebugLog turns them into log entries.
  const debugOptions = { ...options, debug: true }
  const stopCapture = captureDebugLog(adapter, onCall, isActive)

  if (adapter === 'shopify') {
    // Stand in for window.Shopify, so the Customer Privacy API's three branches can be exercised.
    const privacy = options.shopifyPrivacy ?? 'absent'
    const shopifyGlobal: Record<string, unknown> = {
      shop: 'acme-demo.myshopify.com',
      currency: { active: 'USD' },
      locale: 'en-US',
    }
    if (privacy !== 'absent') {
      shopifyGlobal.customerPrivacy = {
        analyticsProcessingAllowed: () => privacy === 'allowed',
        currentVisitorConsent: () => ({ analytics: privacy === 'allowed' ? 'yes' : 'no' }),
      }
    }
    ;(window as unknown as Record<string, unknown>).Shopify = shopifyGlobal

    const analytics = shopifyAnalyticsDouble()
    plugin = shopifyPlugin({ ...debugOptions, analytics: analytics.api as never })
    emit = (fixture) => analytics.emit(fixture)
  } else if (adapter === 'woocommerce') {
    // Woo dispatches its block events on an element, so the adapter listens on one here too.
    const target = new EventTarget()
    const orderFixtureRef: { current: unknown } = { current: null }
    plugin = wooCommercePlugin({
      ...debugOptions,
      target,
      // The order-received payload is read at init, so it is supplied lazily: the sandbox lets
      // you fire "order received" as a step rather than only at page load.
      get data() {
        return orderFixtureRef.current as never
      },
    })
    emit = (fixture) => {
      if (fixture.event === 'order_received') {
        // A reload of the thank-you page is a fresh adapter reading the same payload.
        orderFixtureRef.current = fixture.payload
        const reloaded = wooCommercePlugin({ ...debugOptions, target, data: fixture.payload as never })
        void reloaded.onInit?.({ initConfiguration, publicApi })
        return
      }
      target.dispatchEvent(new CustomEvent(fixture.event, { detail: fixture.payload }))
    }
  } else {
    plugin = oneTrustPlugin({ category: options.category ?? 'C0002', debug: true })
    emit = (fixture) => {
      // Set the global the way the banner script does, then fire the signal OneTrust fires.
      const groups = (fixture.payload as { activeGroups?: string }).activeGroups ?? ''
      ;(window as unknown as Record<string, unknown>).OnetrustActiveGroups = groups
      window.dispatchEvent(new Event('OneTrustGroupsUpdated'))
    }
  }

  const outcome = plugin.onInit?.({ initConfiguration, publicApi })

  return {
    emit,
    initConfiguration,
    initialized: outcome !== false,
    dispose: () => {
      active = false
      stopCapture()
    },
  }
}
