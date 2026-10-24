import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/**
 * Two projects, because the suites need different environments:
 *
 * - `unit` runs the core, the mapping functions and every adapter's fixture and conformance
 *   suite in Node, against a fake `publicApi`. Fast, and what most changes touch.
 * - `browser` runs the real-SDK integration test in headless Chromium. The Datadog Browser SDK
 *   does not start a session under jsdom (no view, nothing sent), so a real browser is the only
 *   way to assert on what actually reaches the intake.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Tests run against the core's source, not its last build, so a change to the core is
      // caught by every adapter's suite without rebuilding first.
      '@kyletaylored/datadog-rum-community-plugins': resolvePath('./packages/core/src/index.ts'),
      '@kyletaylored/datadog-rum-test-harness': resolvePath('./packages/test-harness/src/index.ts'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['packages/*/test/**/*.integration.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
