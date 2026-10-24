/** Shared setup for the browser integration tests: one real SDK init per page, with the intake
 *  intercepted and a poll that waits for a batch instead of sleeping for a fixed time. */
import { vi } from 'vitest'
import { interceptIntake, type IntakeRecorder } from '../../../test-harness/src/intake.js'
import type { RumPlugin } from '@kyletaylored/datadog-rum-community-plugins'

export interface RumHarness {
  intake: IntakeRecorder
  waitForAction: (name: string, timeoutMs?: number) => Promise<{ name: string; context: Record<string, unknown> }[]>
  waitForBatch: (timeoutMs?: number) => Promise<void>
  restore: () => void
}

export interface InitOptions {
  /** Leave unset for the SDK default (`granted`). */
  trackingConsent?: 'granted' | 'not-granted'
  clearStorage?: boolean
}

export async function initRum(plugins: RumPlugin[], options: InitOptions = {}): Promise<RumHarness> {
  if (options.clearStorage !== false) localStorage.clear()

  // Patched before the SDK is imported, so the SDK picks up the patched transport.
  const intake = interceptIntake()
  vi.resetModules()
  const { datadogRum } = await import('@datadog/browser-rum')

  datadogRum.init({
    applicationId: '00000000-0000-0000-0000-000000000000',
    clientToken: 'pub0000000000000000000000000000000',
    site: 'datadoghq.com',
    service: 'integration-test',
    env: 'test',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    trackLongTasks: false,
    trackUserInteractions: false,
    // Resources stay on, as they are on a real storefront. With them off the SDK has so little
    // to send that a batch can sit unflushed for the length of the test.
    trackResources: true,
    ...(options.trackingConsent ? { trackingConsent: options.trackingConsent } : {}),
    plugins,
  })

  /** Nudge the page-exit flush, since a test page never actually unloads. */
  const nudge = () => {
    window.dispatchEvent(new Event('beforeunload'))
    window.dispatchEvent(new Event('pagehide'))
  }

  return {
    intake,
    async waitForAction(name, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = intake.customActions().filter((action) => action.name === name)
        if (found.length > 0) {
          // Let any batch still in flight land, so "exactly once" assertions are honest.
          await new Promise((resolve) => setTimeout(resolve, 200))
          return intake.customActions().filter((action) => action.name === name)
        }
        nudge()
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return []
    },
    async waitForBatch(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (intake.requestCount() > 0) return
        nudge()
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    },
    restore: () => intake.restore(),
  }
}
