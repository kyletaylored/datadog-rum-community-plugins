/**
 * The sandbox runtime, shared by the sandbox page and the demo sites it frames.
 *
 * Each demo under `public/demos/<name>/` loads the plugin's **built** CDN bundle and starts it
 * against the recording `publicApi` below (bundled into `demos/_shared/runtime.js` by
 * `scripts/build-demos.mjs`). The sandbox page only renders what the demo posts back.
 *
 * It never initializes RUM and never asks for an application ID or client token — the site must
 * not handle credentials. That is not only a safety rule, it is what makes the sandbox useful:
 * recording the calls a plugin *would* make is the only way to show the consent gate holding
 * events back, the purchase dedupe refusing a second order, and card data being stripped. A live
 * RUM demo could show none of those, because the whole point is that nothing is sent.
 */
import { DEDUPE_STORAGE_KEY } from '@kyletaylored/datadog-rum-community-plugins'
import type { RumPublicApi } from '@kyletaylored/datadog-rum-community-plugins'

/** One recorded call, as the feed renders it. */
export interface SandboxCall {
  api: string
  /** Action name, context key, or consent state — whatever identifies the call at a glance. */
  label?: string
  detail?: unknown
  /** Set when the core refused to send something, with the reason. */
  blocked?: string
  /** The platform event or page signal the call came from, e.g. `wc-blocks_added_to_cart`. */
  source?: string
  /** What the platform payload carried that this call does not, e.g. `card_number, cvv`. */
  stripped?: string
}

// ---- Bridge protocol --------------------------------------------------------------------------

export const MESSAGE = {
  /** demo → sandbox, once per recorded call, refusals included. */
  call: 'ddrum-sandbox:call',
  /** demo → sandbox, on every page load inside the demo. */
  ready: 'ddrum-sandbox:ready',
  /** demo → sandbox, when a scenario has played its last step. */
  done: 'ddrum-sandbox:done',
  /** sandbox → demo: store these options, clear the session, reload the entry page. */
  configure: 'ddrum-sandbox:configure',
  /** sandbox → demo: drive the real UI through one scenario. */
  play: 'ddrum-sandbox:play',
} as const

export type BridgeMessage =
  | { type: typeof MESSAGE.call; plugin: string; page: string; call: SandboxCall }
  | { type: typeof MESSAGE.ready; plugin: string; page: string; url: string }
  | { type: typeof MESSAGE.done; plugin: string; scenario: string }
  | { type: typeof MESSAGE.configure; options: Record<string, unknown>; platform?: Record<string, unknown> }
  | { type: typeof MESSAGE.play; scenario: string; stepMs?: number }

/** Both sides ignore anything not from their own origin, and anything not shaped like the protocol. */
export function readMessage(event: MessageEvent): BridgeMessage | null {
  if (event.origin !== location.origin) return null
  const data = event.data as { type?: unknown } | null
  if (!data || typeof data.type !== 'string' || !data.type.startsWith('ddrum-sandbox:')) return null
  return data as BridgeMessage
}

// ---- Recording ----------------------------------------------------------------------------------

/**
 * Forwards the core's own debug log into the sandbox.
 *
 * The plugins run with `debug: true`, and the core reports every refusal through
 * `logger.dropped(...)` on `console.log`. Reading that channel rather than inventing one means the
 * sandbox shows exactly what a merchant sees when they follow the docs and turn debug on — and it
 * is the only way to surface a *refusal*, which by definition produces no RUM call. Without it the
 * purchase dedupe looks like nothing happening.
 */
export function captureDebugLog(
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

/** Records instead of sending, and reports each call as it happens so the feed can stream. */
export function createRecorder(onCall: (call: SandboxCall) => void, isActive: () => boolean): RumPublicApi {
  const report = (call: SandboxCall) => {
    // A superseded session must stay silent. Plugins subscribe for the life of the page — the
    // OneTrust one registers a window listener and never removes it, which is correct on a real
    // site — so a stale instance would otherwise report twice.
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

/**
 * Clears the core's purchase-dedupe entry. A fresh session starts with it empty, so a demo does
 * not look broken on a second visit — but a reload of the thank-you page inside one session
 * deliberately keeps it, because that is the behaviour being demonstrated.
 */
export function clearDedupe(): void {
  try {
    localStorage.removeItem(DEDUPE_STORAGE_KEY)
  } catch {
    // Storage blocked: the core's in-memory fallback still applies for this page.
  }
}

// ---- Options ------------------------------------------------------------------------------------

/** The sandbox's controls, which are not one-to-one with any single plugin's options. */
export interface SandboxState {
  /** "Visitor has accepted the cookie banner": `consent: 'ignore'` on the plugin. */
  consent: boolean
  /** Simulates `window.Shopify.customerPrivacy`. `absent` is the pixel sandbox. */
  customerPrivacy: 'absent' | 'allowed' | 'denied'
  identifyUsers: boolean
  includeEmail: boolean
  includeName: boolean
  includeItems: boolean
  actionPrefix: string
  category: string
}

export const DEFAULT_STATE: SandboxState = {
  consent: true,
  customerPrivacy: 'absent',
  identifyUsers: true,
  includeEmail: false,
  includeName: false,
  includeItems: false,
  actionPrefix: 'commerce.',
  category: 'C0002',
}

interface ManifestOption {
  name: string
  default: unknown
}

/**
 * The options object the plugin is actually called with, holding only what differs from the
 * plugin's own defaults (read from its `plugin.json`). The demo is started with exactly this, and
 * the generated `init()` prints exactly this, so the snippet cannot describe a different setup
 * from the one the feed shows.
 */
export function pluginOptions(plugin: string, state: SandboxState, manifestOptions: ManifestOption[]): Record<string, unknown> {
  const defaults = new Map(manifestOptions.map((option) => [option.name, option.default]))
  const wanted: Record<string, unknown> = {}

  if (plugin === 'onetrust') {
    wanted.category = state.category
  } else {
    if (plugin !== 'shopify' && state.consent) wanted.consent = 'ignore'
    if (plugin !== 'engagement') {
      wanted.identifyUsers = state.identifyUsers
      wanted.includeEmail = state.includeEmail
      wanted.includeName = state.includeName
      wanted.includeItems = state.includeItems
      wanted.actionPrefix = state.actionPrefix || 'commerce.'
    }
  }

  const options: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(wanted)) {
    // Only options this plugin declares: the sandbox's commerce controls mean nothing to a
    // learning plugin, and printing them would hand a merchant options the plugin ignores.
    if (defaults.has(key) && defaults.get(key) !== value) options[key] = value
  }
  return options
}

/** Platform doubles the demo stands up, which are not plugin options. */
export function platformState(plugin: string, state: SandboxState): Record<string, unknown> {
  return plugin === 'shopify' ? { customerPrivacy: state.customerPrivacy } : {}
}

function literal(value: unknown): string {
  return typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : JSON.stringify(value)
}

/** The `init()` a merchant would paste for this exact setup. Never holds a real ID or token. */
export function initSnippet(plugin: string, options: Record<string, unknown>): string {
  const entries = Object.entries(options).map(([key, value]) => `${key}: ${literal(value)}`)
  const args = entries.length > 0 ? `{ ${entries.join(', ')} }` : ''
  const comment = plugin === 'shopify' ? '\n    // Settings › Customer events › custom pixel' : ''
  return [
    'window.DD_RUM.init({',
    "  applicationId: 'YOUR_APPLICATION_ID',",
    "  clientToken: 'YOUR_CLIENT_TOKEN',",
    "  site: 'datadoghq.com',",
    `  plugins: [${comment}`,
    `    window.DD_RUM_PLUGINS['${plugin}'](${args}),`,
    '  ],',
    '})',
  ].join('\n')
}
