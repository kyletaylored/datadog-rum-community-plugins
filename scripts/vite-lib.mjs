// Shared Vite library config. Every package builds ES + CJS for npm; adapters also build an
// IIFE for the CDN that registers itself on window.DD_RUM_PLUGINS.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** `@datadog/browser-rum` is always a peer, never bundled. */
const ALWAYS_EXTERNAL = [/^@datadog\/browser-rum/]

/**
 * @param {{ entry?: string, dts?: boolean, iife?: { entry: string, globalName: string } | null,
 *           externalCore?: boolean }} options
 */
export function libConfig(options = {}) {
  const { entry = 'src/index.ts', dts = true, externalCore = true } = options

  return async () => {
    /** @type {import('vite').PluginOption[]} */
    const plugins = []
    if (dts) {
      const { default: dtsPlugin } = await import('vite-plugin-dts')
      // Emits per-file declarations plus an index.d.ts that re-exports them. Publishing `src`
      // alongside dist is what makes the .d.ts.map and .js.map files resolve, so a merchant
      // debugging a plugin lands on commented source rather than a minified bundle.
      plugins.push(dtsPlugin({ include: ['src'] }))
    }

    return {
      plugins,
      build: {
        target: 'es2019',
        minify: true,
        sourcemap: true,
        emptyOutDir: true,
        outDir: 'dist',
        lib: {
          entry: resolve(process.cwd(), entry),
          formats: ['es', 'cjs'],
          fileName: (format) => (format === 'cjs' ? 'index.cjs' : 'index.js'),
        },
        rollupOptions: {
          external: externalCore
            ? [...ALWAYS_EXTERNAL, '@kyletaylored/datadog-rum-community-plugins']
            : ALWAYS_EXTERNAL,
        },
      },
    }
  }
}

/**
 * The CDN build: one self-registering IIFE, with the core bundled in so a merchant pastes a
 * single script tag. CI holds this output under 5 KB gzip.
 * @param {{ entry?: string, name: string }} options
 */
export function cdnConfig(options) {
  const entry = options.entry ?? 'src/cdn.ts'
  return () => ({
    build: {
      target: 'es2019',
      minify: true,
      sourcemap: true,
      emptyOutDir: false,
      outDir: 'dist',
      lib: {
        entry: resolve(process.cwd(), entry),
        formats: ['iife'],
        name: `DD_RUM_PLUGIN_${options.name.toUpperCase().replace(/-/g, '_')}`,
        fileName: () => 'plugin.js',
      },
      rollupOptions: {
        // The core is bundled; only the RUM SDK stays external.
        external: ALWAYS_EXTERNAL,
        output: { extend: true },
      },
    },
  })
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
