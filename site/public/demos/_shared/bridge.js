/**
 * The demo side of the sandbox bridge. Every demo page imports this and calls `startDemo`.
 *
 * It starts the plugin's built CDN bundle against the sandbox's recording publicApi
 * (`runtime.js`, generated from site/src/lib/sandbox.ts), and posts every call — and every
 * refusal the core logs — to the sandbox that frames the page. Opened on its own, it shows the
 * same calls in a small log in the corner instead.
 *
 * Rules a demo must keep, checked by `npm run lint:demos`:
 *   - never call addAction (or any RUM API) itself; the plugin does the mapping or the demo
 *     proves nothing;
 *   - dispatch the platform's real event shape, built from the plugin's fixtures;
 *   - never initialize RUM, and never hold an application ID or client token.
 *
 * Messages, both directions checked against `location.origin`:
 *   demo → sandbox   { type: 'ddrum-sandbox:call', plugin, page, call }
 *                    { type: 'ddrum-sandbox:ready', plugin, page, url }
 *                    { type: 'ddrum-sandbox:done', plugin, scenario }
 *   sandbox → demo   { type: 'ddrum-sandbox:configure', options, platform }   fresh session
 *                    { type: 'ddrum-sandbox:play', scenario, stepMs? }
 */

const runtime = window.DDRumSandbox
const framed = window.parent !== window
const DEFAULT_STEP_MS = 750

const key = (plugin, name) => `ddrum-demo:${plugin}:${name}`

function readJson(storageKey) {
  try {
    const raw = sessionStorage.getItem(storageKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeJson(storageKey, value) {
  try {
    if (value === null) sessionStorage.removeItem(storageKey)
    else sessionStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Storage blocked: the demo still works for a single page, it just forgets across navigation.
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A brief outline on whatever a scenario is about to touch, so a viewer can follow it. */
function flash(element) {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  element.classList.add('demo-flash')
  setTimeout(() => element.classList.remove('demo-flash'), 600)
}

/**
 * @param {{
 *   plugin: string,                    // the plugin's slug, also its debug-log tag
 *   page: string,                      // this page's name in the feed, e.g. 'Checkout'
 *   entry?: string,                    // the page `configure` reloads to, relative to the demo
 *   defaults?: Record<string, unknown>,// plugin options when opened outside the sandbox
 *   scenarios?: Record<string, ((demo) => unknown)[]>,
 *   sourceFor?: (call) => string | undefined,
 * }} config
 */
export function startDemo(config) {
  const { plugin, page, entry = 'index.html', defaults = {}, scenarios = {}, sourceFor } = config
  const stored = readJson(key(plugin, 'options'))
  const options = stored?.options ?? defaults
  const platform = stored?.platform ?? {}

  let context = null
  let navigating = false
  const panel = framed ? null : createPanel(plugin)

  function post(call) {
    if (!call.source) call.source = context?.source ?? sourceFor?.(call)
    if (call.api === 'addAction' && context?.stripped) call.stripped = context.stripped
    if (framed) {
      window.parent.postMessage({ type: runtime.MESSAGE.call, plugin, page, call }, location.origin)
    } else {
      panel.add(call)
    }
  }

  runtime.captureDebugLog(plugin, post, () => true)
  const publicApi = runtime.createRecorder(post, () => true)

  /**
   * Run `fn` with every call it causes attributed to `source`. `payload` is the platform payload
   * being handed over: its blocked keys are listed as stripped, unless `stripped` says otherwise.
   */
  function as(source, fn, { payload, stripped } = {}) {
    const previous = context
    const keys = payload === undefined ? [] : runtime.blockedKeys(payload)
    context = { source, stripped: stripped ?? (keys.length > 0 ? `stripped from the payload: ${keys.join(', ')}` : undefined) }
    try {
      return fn()
    } finally {
      context = previous
    }
  }

  /**
   * Attribute calls caused by a native event the visitor is dispatching right now (a click, a
   * submit) to `source`. Call it from a capture listener on `window`, which runs before the
   * plugin's own listener on `document`; it lasts until the event has finished dispatching.
   */
  function during(source, { stripped } = {}) {
    context = { source, stripped }
    setTimeout(() => {
      context = null
    }, 0)
  }

  const demo = {
    plugin,
    page,
    framed,
    /** The plugin options for this session, with `debug: true` so refusals are logged. */
    options: { ...options, debug: true },
    /** Platform doubles to stand up, e.g. `{ customerPrivacy: 'denied' }` for Shopify. */
    platform,
    as,
    during,
    /** Start a built plugin against the recorder, the way `datadogRum.init` would. */
    init(instance, { source, payload } = {}) {
      const initConfiguration = {}
      const outcome = as(source ?? 'onInit', () => instance.onInit?.({ initConfiguration, publicApi }), { payload })
      // A consent plugin's whole effect at init is to rewrite the init options: no RUM call.
      if (initConfiguration.trackingConsent) {
        post({ api: 'init', label: `trackingConsent = '${initConfiguration.trackingConsent}'`, source: source ?? 'onInit' })
      }
      if (outcome === false) post({ api: 'debug', label: 'the plugin opted out of this page', source: source ?? 'onInit' })
      return outcome
    },
    /** Session state for the demo itself (a cart, a consent answer), cleared by `configure`. */
    state(name, value) {
      if (value === undefined) return readJson(key(plugin, `state:${name}`))
      writeJson(key(plugin, `state:${name}`), value)
      return value
    },

    // ---- Scenario helpers: drive the real UI ------------------------------------------------
    sleep,
    click(selector) {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`scenario: nothing matches ${selector} on ${page}`)
      flash(element)
      element.click()
      return element
    },
    /** Click something that leaves this page; the scenario resumes on the next one. */
    follow(selector) {
      navigating = true
      demo.click(selector)
    },
    go(href) {
      navigating = true
      location.href = href
    },
    reload() {
      navigating = true
      location.reload()
    },
    type(selector, text) {
      const input = document.querySelector(selector)
      if (!input) throw new Error(`scenario: nothing matches ${selector} on ${page}`)
      flash(input)
      input.focus()
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return input
    },
    /** Press a key in a field, e.g. Enter in a search box. */
    press(selector, key) {
      const input = document.querySelector(selector)
      if (!input) throw new Error(`scenario: nothing matches ${selector} on ${page}`)
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      return input
    },
    scrollTo(fraction) {
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo({ top: Math.max(0, max * fraction), behavior: 'smooth' })
      return sleep(500)
    },
  }

  async function play() {
    const progress = readJson(key(plugin, 'play'))
    if (!progress) return
    const steps = scenarios[progress.scenario]
    if (!steps) {
      writeJson(key(plugin, 'play'), null)
      return
    }
    for (let index = progress.step; index < steps.length; index += 1) {
      await sleep(progress.stepMs)
      // Saved before the step runs: a step that navigates ends this page mid-loop, and the next
      // page picks up from here.
      writeJson(key(plugin, 'play'), { ...progress, step: index + 1 })
      await steps[index](demo)
      if (navigating) return
    }
    writeJson(key(plugin, 'play'), null)
    if (framed) window.parent.postMessage({ type: runtime.MESSAGE.done, plugin, scenario: progress.scenario }, location.origin)
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return
    const message = event.data
    if (!message || typeof message.type !== 'string') return

    if (message.type === runtime.MESSAGE.configure) {
      // A fresh session: options replaced, the demo's own state and the purchase dedupe cleared.
      try {
        for (const storageKey of Object.keys(sessionStorage)) {
          if (storageKey.startsWith(`ddrum-demo:${plugin}:`)) sessionStorage.removeItem(storageKey)
        }
      } catch {}
      runtime.clearDedupe()
      writeJson(key(plugin, 'options'), { options: message.options ?? {}, platform: message.platform ?? {} })
      navigating = true
      location.href = new URL(entry, location.href).href
    } else if (message.type === runtime.MESSAGE.play) {
      writeJson(key(plugin, 'play'), { scenario: message.scenario, step: 0, stepMs: message.stepMs ?? DEFAULT_STEP_MS })
      void play()
    }
  })

  /** Call once the page has started its plugin and wired its UI. */
  demo.ready = () => {
    if (framed) {
      window.parent.postMessage({ type: runtime.MESSAGE.ready, plugin, page, url: location.pathname }, location.origin)
    }
    // A scenario that navigated here carries on.
    void play()
  }

  return demo
}

/** The corner log shown when a demo is opened outside the sandbox. */
function createPanel(plugin) {
  const root = document.createElement('aside')
  root.className = 'demo-panel'
  root.setAttribute('aria-live', 'polite')
  root.innerHTML = `<header><strong>What the ${plugin} plugin sent</strong><a href="../../sandbox/?plugin=${plugin}">Open the sandbox →</a></header><ol></ol>`
  const list = root.querySelector('ol')
  const style = document.createElement('style')
  style.textContent = `
    .demo-panel { position: fixed; right: 12px; bottom: 12px; z-index: 9999; width: min(360px, calc(100vw - 24px)); max-height: 40vh; display: flex; flex-direction: column; background: #14141f; color: #f7f7fb; border: 1px solid #3d3d57; border-radius: 10px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 14px 40px -12px rgb(0 0 0 / .6); }
    .demo-panel header { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #2a2a3d; font-family: ui-sans-serif, system-ui, sans-serif; }
    .demo-panel header a { color: #a78bfa; }
    .demo-panel ol { list-style: none; margin: 0; padding: 4px 10px 8px; overflow-y: auto; }
    .demo-panel li { padding: 3px 0; border-bottom: 1px solid #2a2a3d; overflow-wrap: anywhere; }
    .demo-panel .sent { color: #34d399; } .demo-panel .stop { color: #fb7185; } .demo-panel .meta { color: #8f8fa8; }
  `
  document.head.append(style)
  const mount = () => document.body.append(root)
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })

  return {
    add(call) {
      const item = document.createElement('li')
      const kind = call.blocked ? 'stop' : ['addAction', 'setUser', 'setAccount', 'setTrackingConsent'].includes(call.api) ? 'sent' : 'meta'
      item.className = kind
      item.textContent = `${call.blocked ? '✕ not sent' : call.api}${call.label ? ` ${call.label}` : ''}${call.blocked ? ` — ${call.blocked}` : ''}`
      list.append(item)
      list.scrollTop = list.scrollHeight
    },
  }
}
