// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://shop.example.com/" }
//
// The URL matters: document.location.host is what separates an internal link from an outbound
// one, and jsdom resolves relative hrefs against it. It cannot be redefined after the fact —
// jsdom's location sits behind a proxy that refuses defineProperty — so it is set here.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkConformance, createFakeRum, formatFindings, writeEventReport } from '../../test-harness/src/index.js'
import type { FakeRum } from '../../test-harness/src/index.js'
import type { PluginManifest } from '@kyletaylored/datadog-rum-community-plugins'
import { engagementPlugin } from '../src/index.js'
import { readLink, scrollDepth } from '../src/dom.js'

// jsdom replaces import.meta.url, so paths resolve from the repo root (vitest's cwd).
const packageDir = 'packages/plugin-engagement'
const manifest = JSON.parse(readFileSync(`${packageDir}/plugin.json`, 'utf8')) as PluginManifest
const fixtures = JSON.parse(readFileSync(`${packageDir}/fixtures/interactions.json`, 'utf8')).fixtures as {
  name: string
  event: string
  payload: Record<string, unknown>
}[]

const HOST = 'shop.example.com'

function setup(options: Parameters<typeof engagementPlugin>[0] = {}) {
  document.body.innerHTML = ''
  const rum = createFakeRum({})
  engagementPlugin({ consent: 'ignore', trackScroll: false, ...options }).onInit?.({
    initConfiguration: rum.initConfiguration,
    publicApi: rum.publicApi,
  })
  return rum
}

/** Build the fixture's markup, dispatch its event, and let the plugin's own listeners run. */
function play(fixture: (typeof fixtures)[number], rum: FakeRum) {
  void rum
  if (fixture.event === 'scroll') return

  const host = document.createElement('div')
  host.innerHTML = String(fixture.payload.html ?? '')
  document.body.append(host)
  const element = host.firstElementChild as HTMLElement | null
  if (!element) return

  // A browser knows a video's duration once its metadata loads; jsdom never does. The fixture
  // records it as data-duration, so give the element that, or the run under-reports video_start.
  if (element instanceof HTMLVideoElement && element.dataset.duration) {
    Object.defineProperty(element, 'duration', { value: Number(element.dataset.duration), configurable: true })
  }

  switch (fixture.event) {
    case 'click':
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      break
    case 'play':
    case 'ended':
      element.dispatchEvent(new Event(fixture.event))
      break
    case 'timeupdate': {
      const video = element as HTMLVideoElement
      const percent = Number(fixture.payload.percent ?? 0)
      Object.defineProperty(video, 'currentTime', { value: (percent / 100) * video.duration, configurable: true })
      video.dispatchEvent(new Event('timeupdate'))
      break
    }
    case 'focusin':
      element.querySelector('input')?.dispatchEvent(new Event('focusin', { bubbles: true }))
      break
    case 'submit':
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      break
  }
}

describe('link reading', () => {
  it('never returns the address behind a mailto link', () => {
    const anchor = document.createElement('a')
    anchor.href = 'mailto:sales@example.com?subject=Demo'
    anchor.textContent = 'Email sales'
    const link = readLink(anchor, HOST)
    expect(link).toEqual({ type: 'email', text: 'Email sales' })
    expect(JSON.stringify(link)).not.toContain('sales@example.com')
  })

  it('drops the link text when the text is the address', () => {
    const anchor = document.createElement('a')
    anchor.href = 'mailto:sales@relay.example'
    anchor.textContent = 'sales@relay.example'
    expect(readLink(anchor, HOST)).toEqual({ type: 'email', text: undefined })
  })

  it('drops the link text when the text is the number, however it is formatted', () => {
    const anchor = document.createElement('a')
    anchor.href = 'tel:+15550100199'
    anchor.textContent = '+1 (555) 010-0199'
    expect(readLink(anchor, HOST)).toEqual({ type: 'phone', text: undefined })
  })

  it('never returns the number behind a tel link', () => {
    const anchor = document.createElement('a')
    anchor.href = 'tel:+15551234567'
    anchor.textContent = 'Call us'
    expect(JSON.stringify(readLink(anchor, HOST))).not.toContain('5551234567')
  })

  it('drops the query string, which is where tokens live', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://portal.example.org/account?token=sk_live_9f2a&email=a%40b.com'
    const link = readLink(anchor, HOST)
    expect(link?.domain).toBe('portal.example.org')
    expect(link?.path).toBe('/account')
    expect(JSON.stringify(link)).not.toContain('sk_live')
    expect(JSON.stringify(link)).not.toContain('a%40b.com')
  })

  it('distinguishes internal from outbound', () => {
    const internal = document.createElement('a')
    internal.href = `https://${HOST}/about`
    expect(readLink(internal, HOST)?.type).toBe('internal')

    const outbound = document.createElement('a')
    outbound.href = 'https://partner.example.org/pricing'
    expect(readLink(outbound, HOST)?.type).toBe('outbound')
  })

  it('ignores links that say nothing useful', () => {
    for (const href of ['#section', 'javascript:void(0)']) {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', href)
      expect(readLink(anchor, HOST)).toBeUndefined()
    }
  })

  it('falls back to an accessible label for an icon-only link, never to the href', () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://partner.example.org/x'
    anchor.setAttribute('aria-label', 'Partner site')
    expect(readLink(anchor, HOST)?.text).toBe('Partner site')
  })
})

describe('scroll depth', () => {
  it('reports 100 for a page shorter than the viewport', () => {
    const doc = { documentElement: { scrollHeight: 400, scrollTop: 0 }, body: { scrollHeight: 400 } } as unknown as Document
    expect(scrollDepth(doc, { innerHeight: 800, scrollY: 0 } as Window)).toBe(100)
  })

  it('reports a rounded percentage of the scrollable distance', () => {
    const doc = { documentElement: { scrollHeight: 2000, scrollTop: 0 }, body: { scrollHeight: 2000 } } as unknown as Document
    expect(scrollDepth(doc, { innerHeight: 1000, scrollY: 500 } as Window)).toBe(50)
  })
})

describe('clicks', () => {
  it('reports an outbound click with the host and path only', () => {
    const rum = setup()
    document.body.innerHTML = '<a href="https://partner.example.org/pricing?utm_source=news">See pricing</a>'
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(rum.actions()).toEqual([
      {
        api: 'addAction',
        name: 'engagement.click',
        context: {
          link_type: 'outbound',
          outbound: true,
          link_text: 'See pricing',
          link_domain: 'partner.example.org',
          link_path: '/pricing',
        },
      },
    ])
  })

  it('reports a mailto click without the address', () => {
    const rum = setup()
    document.body.innerHTML = '<a href="mailto:sales@example.com">Email sales</a>'
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(rum.actions()[0]?.context).toEqual({ link_type: 'email', outbound: false, link_text: 'Email sales' })
    expect(JSON.stringify(rum.calls)).not.toContain('sales@example.com')
  })

  it('stays quiet on internal navigation, which is already a view', () => {
    const rum = setup()
    document.body.innerHTML = `<a href="https://${HOST}/about">About</a>`
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rum.actions()).toHaveLength(0)
  })

  it('treats a known extension as a download, not an outbound click', () => {
    const rum = setup()
    document.body.innerHTML = `<a href="https://${HOST}/files/q3-report.pdf?sig=abc">Download the Q3 report</a>`
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(rum.actions()[0]).toMatchObject({
      name: 'engagement.file_download',
      context: { file_name: 'q3-report.pdf', file_extension: 'pdf', link_domain: HOST, link_path: '/files/q3-report.pdf' },
    })
    expect(JSON.stringify(rum.calls)).not.toContain('sig=abc')
  })

  it('honours an explicit download attribute whatever the extension', () => {
    const rum = setup()
    document.body.innerHTML = `<a href="https://${HOST}/export" download>Export</a>`
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rum.actions()[0]?.name).toBe('engagement.file_download')
  })

  it('finds the anchor when the click lands on a child element', () => {
    const rum = setup()
    document.body.innerHTML = '<a href="https://partner.example.org/x"><span>Deep</span></a>'
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(rum.actions()).toHaveLength(1)
  })
})

describe('video', () => {
  it('reports start, one event per threshold, and completion', () => {
    const rum = setup()
    document.body.innerHTML = '<video title="Product tour"></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: 200, configurable: true })

    video.dispatchEvent(new Event('play'))
    for (const percent of [12, 30, 30, 55, 80]) {
      Object.defineProperty(video, 'currentTime', { value: (percent / 100) * 200, configurable: true })
      video.dispatchEvent(new Event('timeupdate'))
    }
    video.dispatchEvent(new Event('ended'))

    expect(rum.actions().map((action) => action.name)).toEqual([
      'engagement.video_start',
      'engagement.video_progress',
      'engagement.video_progress',
      'engagement.video_progress',
      'engagement.video_progress',
      'engagement.video_complete',
    ])
    expect(rum.actions().filter((a) => a.name === 'engagement.video_progress').map((a) => a.context.video_percent))
      .toEqual([10, 25, 50, 75])
  })

  it('ignores timeupdate before a duration is known', () => {
    const rum = setup()
    document.body.innerHTML = '<video></video>'
    const video = document.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { value: NaN, configurable: true })
    video.dispatchEvent(new Event('timeupdate'))
    expect(rum.actions()).toHaveLength(0)
  })
})

describe('forms', () => {
  it('reports form_start once, however many fields are touched', () => {
    const rum = setup()
    document.body.innerHTML = '<form id="newsletter"><input name="email"><input name="name"></form>'
    for (const input of document.querySelectorAll('input')) {
      input.dispatchEvent(new Event('focusin', { bubbles: true }))
    }
    expect(rum.actions().filter((action) => action.name === 'engagement.form_start')).toHaveLength(1)
  })

  it('reports the destination host, not the action URL', () => {
    const rum = setup()
    document.body.innerHTML =
      '<form id="newsletter" aria-label="Newsletter signup" action="https://hooks.example.com/subscribe?key=secret"></form>'
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))

    expect(rum.actions()[0]?.context).toEqual({
      form_id: 'newsletter',
      form_name: 'Newsletter signup',
      form_destination: 'hooks.example.com',
    })
    expect(JSON.stringify(rum.calls)).not.toContain('secret')
  })

  it('also counts a marked form as a lead', () => {
    const rum = setup()
    document.body.innerHTML = '<form id="newsletter" data-lead></form>'
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(rum.actions().map((action) => action.name)).toEqual(['engagement.form_submit', 'lead.generate_lead'])
  })

  it('does not count an unmarked form as a lead', () => {
    const rum = setup()
    document.body.innerHTML = '<form id="search"></form>'
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(rum.actions().map((action) => action.name)).toEqual(['engagement.form_submit'])
  })

  it('never reads a field value, even a populated password', () => {
    const rum = setup()
    document.body.innerHTML =
      '<form id="signup" data-lead><input name="email" value="shopper@example.com"><input type="password" value="hunter2"></form>'
    document.querySelector('input')!.dispatchEvent(new Event('focusin', { bubbles: true }))
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))

    const sent = JSON.stringify(rum.calls)
    expect(sent).not.toContain('shopper@example.com')
    expect(sent).not.toContain('hunter2')
  })
})

describe('switches', () => {
  it('each tracker can be turned off independently', () => {
    const rum = setup({ trackClicks: false, trackDownloads: false, trackVideo: false, trackForms: false })
    document.body.innerHTML = '<a href="https://partner.example.org/x">Out</a><form id="f"></form>'
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(rum.actions()).toHaveLength(0)
  })

  it('renaming the commerce prefix leaves engagement and lead alone', () => {
    const rum = setup({ actionPrefix: 'shop.' })
    document.body.innerHTML = '<form id="n" data-lead></form>'
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(rum.actions().map((action) => action.name)).toEqual(['engagement.form_submit', 'lead.generate_lead'])
  })
})

describe('consent', () => {
  it('sends nothing before consent is granted', () => {
    const rum = createFakeRum({})
    engagementPlugin({ trackScroll: false }).onInit?.({
      initConfiguration: rum.initConfiguration,
      publicApi: rum.publicApi,
    })
    document.body.innerHTML = '<a href="https://partner.example.org/x">Out</a>'
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(rum.initConfiguration.trackingConsent).toBe('not-granted')
    expect(rum.actions()).toHaveLength(0)
  })
})

describe('conformance', () => {
  it('passes the shared suite over every fixture', () => {
    const rum = setup()
    for (const fixture of fixtures) play(fixture, rum)
    expect(formatFindings(checkConformance({ manifest, rum }))).toBe('conformance: ok')
  })

  it('leaks nothing from the fixtures that must be stripped', () => {
    const rum = setup()
    for (const fixture of fixtures) play(fixture, rum)
    const sent = JSON.stringify(rum.calls)
    for (const secret of ['sales@example.com', '5551234567', 'sk_live', 'shopper@example.com', 'hunter2', 'sig=abc', 'red tee medium']) {
      expect(sent, `must not contain ${secret}`).not.toContain(secret)
    }
  })

  it('matches the committed snapshot, and generates the published event list', () => {
    const rum = setup()
    for (const fixture of fixtures) play(fixture, rum)
    expect(rum.actions()).toMatchSnapshot()
    writeEventReport(packageDir, 'engagement', rum)
  })
})
