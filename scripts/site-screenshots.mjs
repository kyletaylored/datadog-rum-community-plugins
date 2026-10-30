#!/usr/bin/env node
/**
 * Screenshots site pages for a pull request (AGENTS.md § "Pull requests — screenshots for UI
 * changes"). Serves the built site from `site/dist` on a free port, so it never collides with a
 * dev or preview server already running, and captures each page full-length at desktop and phone
 * width.
 *
 *   npm run site:build
 *   node scripts/site-screenshots.mjs plugins/shopify/ sandbox/
 *   node scripts/site-screenshots.mjs --label before plugins/shopify/   (for a before/after pair)
 *
 * Paths are relative to the site base (`/datadog-rum-community-plugins/`); `/` is the home page.
 * Images go to `.screenshots/` (gitignored) as `<page>-<width>[-<label>].png`. A page that answers
 * with anything but 200, or logs an error to the console, fails the run instead of producing an
 * image nobody should attach.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { chromium } from 'playwright'
import { fromRoot, repoRoot } from './repo-root.mjs'

const BASE = '/datadog-rum-community-plugins/'
const WIDTHS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } }
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

const args = process.argv.slice(2)
const labelIndex = args.indexOf('--label')
const label = labelIndex === -1 ? '' : args.splice(labelIndex, 2)[1]
const pages = args.length > 0 ? args : ['/']

const dist = fromRoot('site/dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('site/dist is not built — run "npm run site:build" first')
  process.exit(1)
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname)
  if (!pathname.startsWith(BASE)) return void response.writeHead(404).end()
  let file = normalize(join(dist, pathname.slice(BASE.length)))
  if (file !== dist && !file.startsWith(dist + sep)) return void response.writeHead(403).end()
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) return void response.writeHead(404).end()
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  response.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const outDir = join(repoRoot, '.screenshots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
let failed = false

try {
  for (const page of pages) {
    const path = page.replace(/^\//, '')
    const name = path.replace(/\/$/, '').replace(/\//g, '-') || 'home'

    for (const [width, viewport] of Object.entries(WIDTHS)) {
      const tab = await browser.newPage({ viewport })
      const errors = []
      tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
      tab.on('pageerror', (error) => errors.push(error.message))

      const response = await tab.goto(`${origin}${BASE}${path}`, { waitUntil: 'networkidle' })
      if (response?.status() !== 200 || errors.length > 0) {
        console.error(`${BASE}${path} at ${width}: HTTP ${response?.status()}${errors.map((e) => `\n  ${e}`).join('')}`)
        failed = true
      } else {
        const file = join(outDir, `${name}-${width}${label ? `-${label}` : ''}.png`)
        await tab.screenshot({ path: file, fullPage: true })
        console.log(file.slice(repoRoot.length + 1))
      }
      await tab.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}

if (failed) process.exit(1)
