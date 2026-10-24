/**
 * Intercepts the RUM SDK's intake requests so an integration test can assert on what actually
 * left the browser, rather than on what a fake `publicApi` recorded.
 *
 * The SDK sends batches to `https://<site-intake>/api/v2/rum?...` as newline-delimited JSON over
 * `fetch` or `sendBeacon`, depending on what the environment offers.
 */

export interface IntakeEvent {
  type?: string
  action?: { type?: string; target?: { name?: string } }
  usr?: Record<string, unknown>
  account?: Record<string, unknown>
  context?: Record<string, unknown>
  [key: string]: unknown
}

export interface IntakeRecorder {
  /** Every event in every batch the SDK tried to send. */
  events: () => IntakeEvent[]
  /** Custom actions only, which is what the adapters produce. */
  customActions: () => { name: string; context: Record<string, unknown> }[]
  requestCount: () => number
  restore: () => void
}

function parsePayload(body: unknown): IntakeEvent[] {
  if (typeof body !== 'string' || body === '') return []
  return body
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as IntakeEvent]
      } catch {
        return []
      }
    })
}

/**
 * Patch `fetch` and `navigator.sendBeacon` for the duration of a test. Intake requests are
 * captured and answered with 202; everything else falls through untouched.
 */
export function interceptIntake(): IntakeRecorder {
  const target = globalThis as Record<string, any>
  const batches: IntakeEvent[][] = []
  let requests = 0

  const isIntake = (url: unknown): boolean =>
    typeof url === 'string' && url.includes('/api/v2/rum')

  const originalFetch = target.fetch
  target.fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input))
    if (isIntake(url)) {
      requests += 1
      const body = init?.body ?? input?.body
      batches.push(parsePayload(typeof body === 'string' ? body : await readBody(body)))
      return new Response('', { status: 202 })
    }
    return originalFetch ? originalFetch(input, init) : Promise.reject(new Error(`unexpected fetch to ${url}`))
  }

  const navigatorRef = target.navigator as { sendBeacon?: (url: string, data?: unknown) => boolean } | undefined
  const originalBeacon = navigatorRef?.sendBeacon
  if (navigatorRef) {
    navigatorRef.sendBeacon = (url: string, data?: unknown) => {
      if (isIntake(url)) {
        requests += 1
        batches.push(parsePayload(typeof data === 'string' ? data : ''))
        return true
      }
      return originalBeacon ? originalBeacon.call(navigatorRef, url, data) : true
    }
  }

  return {
    events: () => batches.flat(),
    customActions: () =>
      batches
        .flat()
        .filter((event) => event.type === 'action' && event.action?.type === 'custom')
        .map((event) => ({
          name: event.action?.target?.name ?? '',
          context: (event.context ?? {}) as Record<string, unknown>,
        })),
    requestCount: () => requests,
    restore: () => {
      if (originalFetch) target.fetch = originalFetch
      else delete target.fetch
      if (navigatorRef) {
        if (originalBeacon) navigatorRef.sendBeacon = originalBeacon
        else delete navigatorRef.sendBeacon
      }
    },
  }
}

async function readBody(body: unknown): Promise<string> {
  if (!body) return ''
  if (typeof (body as Blob).text === 'function') return (body as Blob).text()
  return String(body)
}
