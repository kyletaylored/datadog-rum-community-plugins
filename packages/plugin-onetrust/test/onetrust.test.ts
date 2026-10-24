import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  checkConformance,
  createFakeRum,
  formatFindings,
  loadFixtures,
  writeEventReport,
} from '../../test-harness/src/index.js'
import type { PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { hasConsent, oneTrustPlugin, parseActiveGroups } from '../src/index.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../plugin.json', import.meta.url)), 'utf8'),
) as PluginManifest
const fixtures = loadFixtures(fileURLToPath(new URL('../fixtures', import.meta.url))).flatMap(
  (entry) => entry.fixtures,
)

/**
 * Stands in for the OneTrust banner: sets `OnetrustActiveGroups` the way the script does, then
 * fires the signal. The adapter's own listeners are what run.
 */
function banner() {
  const win = globalThis as unknown as Record<string, unknown> & EventTarget
  return {
    set(activeGroups: string, signal: 'event' | 'wrapper' = 'event') {
      win.OnetrustActiveGroups = activeGroups
      if (signal === 'event') {
        win.dispatchEvent(new Event('OneTrustGroupsUpdated'))
      } else {
        ;(win.OptanonWrapper as (() => void) | undefined)?.()
      }
    },
    preset(activeGroups: string) {
      win.OnetrustActiveGroups = activeGroups
    },
  }
}

let restore: (() => void)[] = []

beforeEach(() => {
  const win = globalThis as unknown as Record<string, unknown>
  const hadTarget = typeof (globalThis as { addEventListener?: unknown }).addEventListener === 'function'
  if (!hadTarget) {
    // Node has EventTarget but no window-level listener surface; give the adapter one.
    const target = new EventTarget()
    for (const method of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
      const bound = target[method].bind(target)
      Object.defineProperty(win, method, { value: bound, configurable: true, writable: true })
      restore.push(() => delete win[method])
    }
  }
  restore.push(() => {
    delete win.OnetrustActiveGroups
    delete win.OptanonWrapper
    delete win.Optanon
  })
})

afterEach(() => {
  for (const undo of restore.reverse()) undo()
  restore = []
})

describe('parseActiveGroups', () => {
  it('reads the comma-delimited string OneTrust sets, commas and all', () => {
    expect(parseActiveGroups(',C0001,C0002,')).toEqual(['C0001', 'C0002'])
  })

  it('returns an empty list for an unanswered banner', () => {
    expect(parseActiveGroups('')).toEqual([])
    expect(parseActiveGroups(undefined)).toEqual([])
    expect(parseActiveGroups(',,')).toEqual([])
  })
})

describe('hasConsent', () => {
  it('requires every category the install asked for', () => {
    expect(hasConsent(['C0001', 'C0002'], ['C0002'])).toBe(true)
    expect(hasConsent(['C0001'], ['C0002'])).toBe(false)
    expect(hasConsent(['C0001', 'C0002'], ['C0002', 'C0004'])).toBe(false)
  })

  it('never grants on an empty requirement, so a misconfigured install fails closed', () => {
    expect(hasConsent(['C0001', 'C0002'], [])).toBe(false)
  })
})

describe('holding RUM', () => {
  it('sets trackingConsent to not-granted before the SDK starts', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(rum.initConfiguration.trackingConsent).toBe('not-granted')
  })

  it('stays held while the banner is unanswered', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set('')
    expect(rum.calls.some((call) => call.api === 'setTrackingConsent' && call.consent === 'granted')).toBe(false)
  })

  it('stays held when only strictly necessary cookies are accepted', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set(',C0001,')
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'not-granted' })
    expect(rum.calls.some((call) => call.api === 'setTrackingConsent' && call.consent === 'granted')).toBe(false)
  })

  it('grants once the performance category is active', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set(',C0001,C0002,')
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
    expect(rum.globalContext()['consent.categories']).toEqual(['C0001', 'C0002'])
  })

  it('reads a decision the banner already made before RUM loaded', () => {
    const rum = createFakeRum({})
    banner().preset(',C0001,C0002,')
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
  })

  it('accepts a different category, and several at once', () => {
    const rum = createFakeRum({})
    oneTrustPlugin({ category: ['C0002', 'C0004'] }).onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    banner().set(',C0001,C0002,')
    expect(rum.calls.some((call) => call.api === 'setTrackingConsent' && call.consent === 'granted')).toBe(false)
    banner().set(',C0001,C0002,C0004,')
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
  })

  it('withdraws consent when the visitor turns the category back off', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set(',C0001,C0002,')
    banner().set(',C0001,')
    const transitions = rum.calls.filter((call) => call.api === 'setTrackingConsent').map((call) => call.consent)
    expect(transitions).toEqual(['granted', 'not-granted'])
  })

  it('replays the whole recorded sequence to the expected transitions', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    const ot = banner()
    for (const fixture of fixtures) {
      ot.set((fixture.payload as { activeGroups: string }).activeGroups)
    }
    // Unanswered reports nothing; reject-all reports not-granted; accepting performance grants;
    // accepting everything is already granted, so it is not reported again; withdrawing denies.
    expect(rum.calls.filter((call) => call.api === 'setTrackingConsent').map((call) => call.consent)).toEqual([
      'not-granted',
      'granted',
      'not-granted',
    ])
  })

  it('can be told not to report the accepted categories', () => {
    const rum = createFakeRum({})
    oneTrustPlugin({ reportCategories: false }).onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    banner().set(',C0001,C0002,')
    expect(rum.globalContext()['consent.categories']).toBeUndefined()
  })
})

describe('OptanonWrapper', () => {
  it('is reached through the wrapper hook as well as the event', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set(',C0001,C0002,', 'wrapper')
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
  })

  it('chains the page’s own wrapper instead of replacing it', () => {
    const win = globalThis as unknown as Record<string, unknown>
    let siteWrapperRan = false
    win.OptanonWrapper = () => {
      siteWrapperRan = true
    }
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set(',C0001,C0002,', 'wrapper')
    expect(siteWrapperRan).toBe(true)
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
  })

  it('survives a page wrapper that throws', () => {
    const win = globalThis as unknown as Record<string, unknown>
    win.OptanonWrapper = () => {
      throw new Error('site bug')
    }
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    expect(() => banner().set(',C0001,C0002,', 'wrapper')).not.toThrow()
    expect(rum.calls).toContainEqual({ api: 'setTrackingConsent', consent: 'granted' })
  })
})

describe('conformance', () => {
  it('passes the shared suite, and emits no actions of its own', () => {
    const rum = createFakeRum({})
    oneTrustPlugin().onInit?.({ initConfiguration: rum.initConfiguration, publicApi: rum.publicApi })
    banner().set(',C0001,C0002,')
    expect(formatFindings(checkConformance({ manifest, rum }))).toBe('conformance: ok')
    expect(rum.actions()).toHaveLength(0)
    // Generated even though the list is empty: the gallery states plainly that a consent adapter
    // sends no actions of its own, rather than leaving the section blank.
    writeEventReport(packageDir, 'onetrust', rum)
  })
})
