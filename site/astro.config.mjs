import mdx from '@astrojs/mdx'
import { defineConfig } from 'astro/config'

// Served from a subpath on GitHub Pages, so every link must be base-aware. Use the `url()`
// helper in src/lib/url.ts rather than writing absolute paths.
export default defineConfig({
  site: 'https://kyletaylored.github.io',
  base: '/datadog-rum-community-plugins',
  trailingSlash: 'always',
  integrations: [mdx()],
  build: { format: 'directory' },
})
