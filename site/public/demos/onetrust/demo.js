/**
 * Relay with a cookie banner: the OneTrust demo.
 *
 * The banner is generic, not OneTrust's own UI, but it answers the way OneTrust's script does:
 * it sets `window.OnetrustActiveGroups` to the comma-delimited string OneTrust uses, then fires
 * `OneTrustGroupsUpdated` — the signal the plugin's fixtures replay. On load it calls the page's
 * `OptanonWrapper`, as the banner script does once it is ready.
 *
 * Only the OneTrust plugin runs here. Its job is to hold RUM, so the page's links, video and form
 * send nothing of their own; pair it with the engagement plugin for that.
 */
import { startDemo } from '../_shared/bridge.js'
import { wireRelay } from '../_shared/relay.js'

const CATEGORIES = [
  { id: 'C0001', label: 'Strictly necessary', locked: true },
  { id: 'C0002', label: 'Performance' },
  { id: 'C0003', label: 'Functional' },
  { id: 'C0004', label: 'Targeting' },
]

/** One per sandbox preset, by id. */
export const scenarios = {
  'walk-the-banner': [
    (d) => d.click('[data-banner] [data-open-prefs]'),
    (d) => d.click('[data-category="C0002"]'),
    (d) => d.click('[data-confirm]'),
    (d) => d.click('[data-reopen]'),
    (d) => d.click('[data-category="C0002"]'),
    (d) => d.click('[data-confirm]'),
  ],
  'require-a-stricter-category': [
    (d) => d.click('[data-banner] [data-open-prefs]'),
    (d) => d.click('[data-category="C0002"]'),
    (d) => d.click('[data-confirm]'),
    (d) => d.click('[data-reopen]'),
    (d) => d.click('[data-prefs] [data-accept-all]'),
  ],
}

const demo = startDemo({ plugin: 'onetrust', page: 'Home', defaults: {}, scenarios })
wireRelay(demo)

// A returning visitor's earlier answer is already on the window when RUM loads.
const answered = demo.state('groups')
if (answered) window.OnetrustActiveGroups = `,${answered.join(',')},`

demo.init(window.DD_RUM_PLUGINS.onetrust(demo.options), { source: 'onInit' })

// The banner script has loaded: OneTrust calls the page's wrapper, which the plugin has chained.
demo.as('OptanonWrapper', () => window.OptanonWrapper?.())

// ---- The banner --------------------------------------------------------------------------------

const banner = document.querySelector('[data-banner]')
const prefs = document.querySelector('[data-prefs]')
const reopen = document.querySelector('[data-reopen]')
const list = document.querySelector('[data-categories]')
let draft = new Set(answered ?? ['C0001'])

function paint() {
  const done = Boolean(demo.state('groups'))
  banner.hidden = done || !prefs.hidden
  reopen.hidden = !done || !prefs.hidden
  for (const button of list.querySelectorAll('[data-category]')) {
    button.setAttribute('aria-checked', String(draft.has(button.dataset.category)))
  }
}

for (const category of CATEGORIES) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'category'
  button.setAttribute('role', 'switch')
  button.dataset.category = category.id
  if (category.locked) button.setAttribute('aria-disabled', 'true')
  button.innerHTML = `<span>${category.label}<small>${category.id}${category.locked ? ' · always on' : ''}</small></span><span class="track" aria-hidden="true"><i></i></span>`
  button.addEventListener('click', () => {
    if (category.locked) return
    if (draft.has(category.id)) draft.delete(category.id)
    else draft.add(category.id)
    paint()
  })
  list.append(button)
}

function answer(groups) {
  const ordered = CATEGORIES.map((category) => category.id).filter((id) => groups.includes(id))
  demo.state('groups', ordered)
  draft = new Set(ordered)
  prefs.hidden = true
  window.OnetrustActiveGroups = `,${ordered.join(',')},`
  demo.as('OneTrustGroupsUpdated', () => window.dispatchEvent(new Event('OneTrustGroupsUpdated')))
  paint()
}

const openPrefs = () => {
  draft = new Set(demo.state('groups') ?? ['C0001'])
  prefs.hidden = false
  paint()
}
for (const button of document.querySelectorAll('[data-open-prefs]')) button.addEventListener('click', openPrefs)
reopen.addEventListener('click', openPrefs)
for (const button of document.querySelectorAll('[data-accept-all]')) {
  button.addEventListener('click', () => answer(CATEGORIES.map((category) => category.id)))
}
document.querySelector('[data-reject-all]').addEventListener('click', () => answer(['C0001']))
document.querySelector('[data-confirm]').addEventListener('click', () => answer([...draft]))

paint()
demo.ready()

/** A consent plugin declares no actions; there is nothing for it to reach. */
export const coverage = { reachable: {} }
