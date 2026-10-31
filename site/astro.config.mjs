import mdx from '@astrojs/mdx'
import { defineConfig } from 'astro/config'

// Served from a subpath on GitHub Pages, so every link must be base-aware. Use the `url()`
// helper in src/lib/url.ts rather than writing absolute paths.
//
// `site` is the host that actually serves the pages: kyletaylored.github.io redirects to the
// custom domain. Canonical URLs and share images are built from it, and a share image on a host
// that redirects is one some crawlers will not follow.
export default defineConfig({
  site: 'https://kyletaylored.com',
  base: '/datadog-rum-community-plugins',
  trailingSlash: 'always',
  integrations: [mdx()],
  build: { format: 'directory' },
})
