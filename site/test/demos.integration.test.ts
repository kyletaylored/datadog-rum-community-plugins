/**
 * Plays every sandbox scenario against its demo site, in a real browser, and checks what the
 * demo posted back over the bridge.
 *
 * The demos run the plugins' built bundles against the sandbox recorder, so this is the check
 * that the sandbox shows what the code does: each action a scenario sends must carry only
 * attributes the fixture run recorded (`fixtures/.generated/events.json`), every action a demo
 * claims to reach must be sent by some scenario, and the consent, dedupe and stripping scenarios
 * must refuse and strip what their notes say they do.
 *
 * It needs `npm run build` first: the demos load `_shared/runtime.js` and the plugin bundles,
 * which `scripts/build-demos.mjs` generates.
 */
import { describe, expect, it } from 'vitest'
import presets from '../src/lib/sandbox-scenarios.json'
import { DEFAULT_STATE, MESSAGE, platformState, pluginOptions, readMessage, type SandboxCall, type SandboxState } from '../src/lib/sandbox'
import wooManifest from '../../packages/plugin-woocommerce/plugin.json'
import shopifyManifest from '../../packages/plugin-shopify/plugin.json'
import engagementManifest from '../../packages/plugin-engagement/plugin.json'
import onetrustManifest from '../../packages/plugin-onetrust/plugin.json'
import learndashManifest from '../../packages/plugin-learndash/plugin.json'
import learndashEvents from '../../packages/plugin-learndash/fixtures/.generated/events.json'
import wooEvents from '../../packages/plugin-woocommerce/fixtures/.generated/events.json'
import shopifyEvents from '../../packages/plugin-shopify/fixtures/.generated/events.json'
import engagementEvents from '../../packages/plugin-engagement/fixtures/.generated/events.json'
import onetrustEvents from '../../packages/plugin-onetrust/fixtures/.generated/events.json'

type Manifest = { name: string; actions?: string[]; options?: { name: string; default: unknown }[] }
type Report = { actions: { name: string; attributes: { name: string; type: string }[] }[] }
type Scenario = { id: string; label: string; state: Partial<SandboxState> }

const PLUGINS: Record<string, { manifest: Manifest; events: Report }> = {
  woocommerce: { manifest: wooManifest as Manifest, events: wooEvents as Report },
  shopify: { manifest: shopifyManifest as Manifest, events: shopifyEvents as Report },
  engagement: { manifest: engagementManifest as Manifest, events: engagementEvents as Report },
  onetrust: { manifest: onetrustManifest as Manifest, events: onetrustEvents as Report },
  learndash: { manifest: learndashManifest as Manifest, events: learndashEvents as Report },
}

/** Fast enough to keep the suite short, slow enough for the demos' own timers to keep up. */
const STEP_MS = 60

/** Frame the demo, configure it like the sandbox does, play one scenario, collect every call. */
function play(plugin: string, scenario: Scenario): Promise<SandboxCall[]> {
  const state = { ...DEFAULT_STATE, ...scenario.state }
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width: 1200px; height: 800px; border: 0'
  frame.src = `/site/public/demos/${plugin}/index.html`
  document.body.append(frame)

  const calls: SandboxCall[] = []
  let configured = false
  let played = false

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`${plugin} ${scenario.id}: no "done" after 30s`)), 30_000)
    function finish(error?: Error) {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      frame.remove()
      if (error) reject(error)
      else resolve(calls)
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return
      const message = readMessage(event)
      if (!message) return
      if (message.type === MESSAGE.ready) {
        if (!configured) {
          configured = true
          const options = pluginOptions(plugin, state, PLUGINS[plugin]!.manifest.options ?? [])
          frame.contentWindow!.postMessage({ type: MESSAGE.configure, options, platform: platformState(plugin, state) }, location.origin)
        } else if (!played) {
          played = true
          frame.contentWindow!.postMessage({ type: MESSAGE.play, scenario: scenario.id, stepMs: STEP_MS }, location.origin)
        }
      } else if (message.type === MESSAGE.call && configured) {
        calls.push(message.call)
      } else if (message.type === MESSAGE.done) {
        // Let the last page's own timers (the video, a deferred scroll measure) settle.
        setTimeout(() => finish(), 400)
      }
    }
    window.addEventListener('message', onMessage)
  })
}

/** The schema type a recorded attribute has, as the JSON value it arrives as. */
function matchesType(type: string, value: unknown): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  return typeof value === type
}

/** The reachable actions a demo declares, read from its source like `lint:demos` does. */
async function reachable(plugin: string): Promise<string[]> {
  const source = await (await fetch(`/site/public/demos/${plugin}/demo.js`)).text()
  const block = /reachable:\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
  return [...block.matchAll(/'([a-z]+\.[a-z_]+)'\s*:/g)].map((match) => match[1]!)
}

const SECRETS = ['4242424242', 'sk_live', 'token=8f2a', 'sig=', 'jane@company.example', '5550100199', 'sales@relay.example', 'billing_address', 'red tee medium']

for (const plugin of presets.order) {
  describe(`the ${plugin} demo`, () => {
    const { events } = PLUGINS[plugin]!
    const recorded = new Map(events.actions.map((action) => [action.name, action.attributes]))
    const sentByAnyScenario = new Set<string>()
    const scenarios = presets.plugins[plugin as keyof typeof presets.plugins].scenarios as Scenario[]

    for (const scenario of scenarios) {
      it(`plays "${scenario.label}"`, { timeout: 40_000 }, async () => {
        const calls = await play(plugin, scenario)
        const state = { ...DEFAULT_STATE, ...scenario.state }
        const actions = calls.filter((call) => call.api === 'addAction')
        for (const action of actions) sentByAnyScenario.add(action.label!)

        expect(calls.length, 'the demo posted nothing').toBeGreaterThan(0)

        // Every attribute on a shared action is one the fixture run recorded, in its type.
        for (const action of actions) {
          const attributes = recorded.get(action.label!)
          if (!attributes) continue
          for (const [key, value] of Object.entries(action.detail as Record<string, unknown>)) {
            const spec = attributes.find((attribute) => attribute.name === key)
            expect(spec, `${action.label} sent ${key}, which the fixture run never recorded`).toBeDefined()
            expect(matchesType(spec!.type, value), `${action.label}.${key} should be ${spec!.type}`).toBe(true)
          }
          if (!state.includeItems) expect(action.detail).not.toHaveProperty('items')
        }

        // Nothing the pages carry that must not arrive did arrive.
        const sent = JSON.stringify(calls.filter((call) => !call.blocked && call.api !== 'debug').map((call) => call.detail))
        for (const secret of SECRETS) expect(sent, `must not send ${secret}`).not.toContain(secret)

        // What each scenario's note promises.
        const held = (plugin === 'shopify' && state.customerPrivacy === 'denied') || (['woocommerce', 'engagement', 'learndash'].includes(plugin) && !state.consent)
        if (held) {
          expect(actions, 'consent was not given, yet actions were sent').toHaveLength(0)
          expect(calls.some((call) => call.api === 'setUser')).toBe(false)
          expect(calls.filter((call) => call.blocked).length).toBeGreaterThan(0)
        } else if (plugin !== 'onetrust') {
          expect(actions.length).toBeGreaterThan(0)
        }
        if (plugin === 'learndash' && state.consent) {
          expect(actions.filter((call) => call.label === 'learning.course_complete')).toHaveLength(1)
          expect(actions.find((call) => call.label === 'learning.quiz_complete')?.detail).toMatchObject({ score: 8, score_max: 10, passed: true })
          expect(JSON.stringify(actions)).not.toContain('answers')
          // The lesson video, from the engagement kit running alongside.
          expect(actions.map((call) => call.label)).toEqual(expect.arrayContaining(['engagement.video_start', 'engagement.video_complete']))
        }
        if (scenario.id === 'completion-page-reloaded') {
          expect(calls.filter((call) => /already reported event/.test(call.blocked ?? ''))).toHaveLength(2)
        }
        if (scenario.id === 'thank-you-page-reloaded') {
          expect(actions.filter((call) => call.label === 'commerce.purchase')).toHaveLength(1)
          expect(calls.some((call) => call.label === 'purchase' && /already counted/.test(call.blocked ?? ''))).toBe(true)
        }
        if (scenario.id === 'card-data-in-the-payload') {
          const payment = actions.find((call) => call.label === 'commerce.add_payment_info')
          expect(payment?.stripped).toMatch(/card_number/)
        }
        if (state.includeEmail && plugin === 'woocommerce') {
          expect(calls.find((call) => call.api === 'setUser')?.detail).toHaveProperty('email')
          expect(JSON.stringify(actions)).not.toContain('@example.com')
        }
        if (plugin === 'onetrust') {
          const consent = calls.filter((call) => call.api === 'setTrackingConsent').map((call) => call.label)
          expect(consent).toEqual(scenario.id === 'walk-the-banner' ? ['granted', 'not-granted'] : ['not-granted', 'granted'])
        }
      })
    }

    it('sends every action its demo claims to reach', async () => {
      const claimed = await reachable(plugin)
      for (const action of claimed) expect(sentByAnyScenario, `${action} is never sent by any scenario`).toContain(action)
    })
  })
}
