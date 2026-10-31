#!/usr/bin/env node
/**
 * Runs after `astro build`. For every page in site/dist it:
 *
 *   1. checks the search and social metadata Base.astro emits is all there: a title, a
 *      description, a canonical URL, the Open Graph and Twitter card tags, and a share image
 *      whose URL matches the page's slug;
 *   2. renders that share image, 1200×630, from one template, using the page's own title and
 *      description, into site/dist/og/<slug>.png.
 *
 * Generated rather than drawn by hand so every page has one and they all look alike, and so a
 * renamed page cannot keep a stale image. A page missing any tag fails the build: a link that
 * previews as a blank card (the failure this exists to prevent) looks broken to whoever it was
 * shared with, and nothing else would catch it. See AGENTS.md "Site pages: search and social
 * metadata".
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { chromium } from 'playwright'
import { fromRoot } from './repo-root.mjs'

const DIST = fromRoot('site/dist')
const BASE = '/datadog-rum-community-plugins/'
const SITE_NAME = 'Datadog RUM Community Plugins'
const WIDTH = 1200
const HEIGHT = 630

if (!existsSync(DIST)) {
  console.error(`${DIST} not found — run the Astro build first`)
  process.exit(1)
}

/** Every built page, skipping the static demo sites: they are framed by the sandbox, not shared. */
function pages(dir = DIST) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'demos' || entry === 'og' ? [] : pages(path)
    return entry === 'index.html' ? [path] : []
  })
}

const attribute = (html, pattern) => {
  const match = pattern.exec(html)
  return match ? match[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : undefined
}
const meta = (html, key) =>
  attribute(html, new RegExp(`<meta (?:name|property)="${key.replace(/:/g, '\\:')}" content="([^"]*)"`))

const plugins = existsSync(fromRoot('site/src/data/plugins.json'))
  ? JSON.parse(readFileSync(fromRoot('site/src/data/plugins.json'), 'utf8'))
  : []

/** The small label above the title, from where the page lives. */
function kicker(path) {
  const plugin = /^plugins\/([^/]+)\/$/.exec(path)?.[1]
  if (plugin) {
    const found = plugins.find((entry) => entry.name === plugin)
    return found ? `Plugin · ${found.family}` : 'Plugin'
  }
  if (path === 'plugins/') return 'Plugin gallery'
  if (path.startsWith('docs/')) return 'Docs'
  if (path === 'sandbox/') return 'Sandbox'
  return 'Community project'
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The one template. Dark, in the site's own tokens, with the disclaimer on every image. */
function card({ heading, description, label, address }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif;
      color: #f7f7fb; background: #0a0a0f; padding: 64px 72px; display: flex; flex-direction: column;
      background-image: radial-gradient(900px 420px at 100% 0%, rgb(139 92 246 / .28), transparent 70%),
                        radial-gradient(700px 380px at 0% 100%, rgb(217 70 239 / .14), transparent 70%);
    }
    .brand { display: flex; align-items: center; gap: 16px; font-size: 28px; font-weight: 720; letter-spacing: -0.02em; }
    .mark { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(100deg, #8b5cf6, #d946ef); display: grid; place-items: center; box-shadow: 0 0 30px -4px #8b5cf6; }
    .label { margin-top: 56px; align-self: flex-start; font-size: 22px; font-weight: 650; color: #a78bfa; background: #241b3d; border: 1px solid #3d3d57; padding: 6px 16px; border-radius: 999px; text-transform: capitalize; }
    h1 { margin-top: 22px; font-size: ${heading.length > 34 ? 60 : 76}px; line-height: 1.05; font-weight: 760; letter-spacing: -0.025em;
         display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    p { margin-top: 22px; font-size: 28px; line-height: 1.4; color: #b9b9cc; max-width: 1000px;
        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    footer { margin-top: auto; display: flex; justify-content: space-between; font-size: 20px; color: #8f8fa8; }
  </style></head><body>
    <div class="brand"><span class="mark"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 9 6l3.6 7 2.4-3.5L21 17"/></svg></span>${SITE_NAME}</div>
    <span class="label">${escape(label)}</span>
    <h1>${escape(heading)}</h1>
    ${description ? `<p>${escape(description)}</p>` : ''}
    <footer><span>${escape(address)}</span><span>Not provided or supported by Datadog.</span></footer>
  </body></html>`
}

const problems = []
const work = []
for (const file of pages().sort()) {
  const path = relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/')
  const html = readFileSync(file, 'utf8')
  const where = `/${path}`
  const slug = path.replace(/\/+$/, '').replace(/\//g, '-') || 'home'

  const title = attribute(html, /<title>([^<]*)<\/title>/)
  const description = meta(html, 'description')
  const canonical = attribute(html, /<link rel="canonical" href="([^"]*)"/)
  const ogImage = meta(html, 'og:image')
  const required = {
    title,
    description,
    canonical,
    'og:title': meta(html, 'og:title'),
    'og:description': meta(html, 'og:description'),
    'og:url': meta(html, 'og:url'),
    'og:image': ogImage,
    'og:image:alt': meta(html, 'og:image:alt'),
    'twitter:card': meta(html, 'twitter:card'),
    'twitter:image': meta(html, 'twitter:image'),
  }
  for (const [key, value] of Object.entries(required)) {
    if (!value) problems.push(`${where}: missing ${key}`)
  }
  if (description && (description.length < 50 || description.length > 200)) {
    problems.push(`${where}: description is ${description.length} characters; keep it between 50 and 200 so previews neither look empty nor get cut mid-word`)
  }
  if (canonical && !canonical.endsWith(`${BASE}${path}`)) problems.push(`${where}: canonical ${canonical} does not match the page`)
  if (ogImage && !ogImage.endsWith(`${BASE}og/${slug}.png`)) problems.push(`${where}: og:image ${ogImage} does not match og/${slug}.png`)
  if (title && [...work].some((entry) => entry.title === title)) problems.push(`${where}: title "${title}" is used by another page`)

  const heading = (meta(html, 'og:title') ?? title ?? '').replace(` · ${SITE_NAME}`, '')
  work.push({ slug, title, heading, description, label: kicker(path), address: `kyletaylored.com${BASE}${path}` })
}

if (problems.length > 0) {
  console.error(`${problems.length} page metadata problem(s):`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

mkdirSync(join(DIST, 'og'), { recursive: true })
const browser = await chromium.launch()
const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
for (const page of work) {
  await tab.setContent(card(page), { waitUntil: 'load' })
  await tab.screenshot({ path: join(DIST, 'og', `${page.slug}.png`), clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
}
await browser.close()

console.log(`site metadata ok on ${work.length} pages; share images written to site/dist/og/`)
