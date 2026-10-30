import {
  createTracker,
  ENGAGEMENT_FAMILY,
  LEAD_FAMILY,
  type CommonPluginOptions,
  type PluginFootprint,
  type RumPlugin,
  type Tracker,
} from '@kyletaylored/datadog-rum-community-plugins'
import {
  DEFAULT_DOWNLOAD_EXTENSIONS,
  readForm,
  readLink,
  readVideo,
  scrollDepth,
  type LinkFacts,
} from './dom.js'

export const PLUGIN_VERSION = '0.2.0'

export const DEFAULT_SCROLL_THRESHOLDS = [25, 50, 75, 90]
export const DEFAULT_VIDEO_THRESHOLDS = [10, 25, 50, 75]

export const FOOTPRINT: PluginFootprint = {
  globals: ['document', 'window'],
  events: ['scroll', 'click', 'play', 'timeupdate', 'ended', 'focusin', 'submit', 'popstate'],
  storageKeys: [],
  rumApis: ['addAction', 'setGlobalContextProperty'],
  consentSource: null,
}

export interface EngagementPluginOptions extends CommonPluginOptions {
  /** Depth percentages that fire `engagement.scroll`. Each fires once per view. */
  scrollThresholds?: number[]
  /** Progress percentages that fire `engagement.video_progress`. */
  videoThresholds?: number[]
  /** Extensions treated as a download. Defaults to common documents, archives and media. */
  downloadExtensions?: string[]
  /**
   * Forms matching this selector also emit `lead.generate_lead` on submit — newsletter signups,
   * contact forms, demo requests. Opt-in by selector rather than guessed from field names, which
   * would mean reading the fields.
   */
  leadFormSelector?: string
  trackScroll?: boolean
  trackClicks?: boolean
  trackDownloads?: boolean
  trackVideo?: boolean
  trackForms?: boolean
  /** Listen somewhere other than `document`. Used by the tests. */
  root?: Document | HTMLElement
}

/**
 * The generic kit: the events an analytics tool captures automatically, with no instrumentation.
 *
 * Scroll depth, outbound and contact clicks, file downloads, video plays and form submissions,
 * mapped onto the shared schema with GA4's event names. Drop it on any site — it reads nothing
 * platform-specific, so it works alongside a commerce or consent plugin rather than instead of one.
 *
 * What it will not send, by construction: any full URL, any query string, the address behind a
 * `mailto:` or `tel:` link, or the value of any form field. See `dom.ts` for why.
 */
export function engagementPlugin(options: EngagementPluginOptions = {}): RumPlugin {
  return {
    name: 'engagement',
    onInit({ initConfiguration, publicApi }) {
      const doc = (options.root as Document | undefined)?.ownerDocument ??
        (options.root as Document | undefined) ??
        (globalThis as { document?: Document }).document
      const win = (globalThis as { window?: Window }).window ?? (globalThis as unknown as Window)

      if (!doc || typeof doc.addEventListener !== 'function') {
        return false
      }

      const tracker = createTracker({
        platform: 'engagement',
        version: PLUGIN_VERSION,
        publicApi,
        families: [ENGAGEMENT_FAMILY, LEAD_FAMILY],
        initConfiguration,
        options,
        footprint: FOOTPRINT,
      })

      const root: Document | HTMLElement = options.root ?? doc
      const host = doc.location?.host ?? ''
      const downloads = new Set(
        (options.downloadExtensions ?? [...DEFAULT_DOWNLOAD_EXTENSIONS]).map((ext) =>
          ext.replace(/^\./, '').toLowerCase(),
        ),
      )

      // ---- Scroll depth --------------------------------------------------
      if (options.trackScroll !== false) {
        const thresholds = [...(options.scrollThresholds ?? DEFAULT_SCROLL_THRESHOLDS)].sort((a, b) => a - b)
        let fired = new Set<number>()
        let queued = false

        const measure = () => {
          queued = false
          const depth = scrollDepth(doc, win)
          for (const threshold of thresholds) {
            if (depth >= threshold && !fired.has(threshold)) {
              fired.add(threshold)
              tracker.track('scroll', { percent_scrolled: threshold })
            }
          }
        }

        // Coalesced into one frame: a scroll listener that measures on every event is the
        // classic way an analytics script becomes the thing slowing the page down.
        root.addEventListener(
          'scroll',
          () => {
            if (queued) return
            queued = true
            ;(win.requestAnimationFrame ?? ((callback: FrameRequestCallback) => win.setTimeout(() => callback(0), 16)))(measure)
          },
          { passive: true },
        )

        // A single-page app changes route without reloading, so thresholds reset. `popstate` only
        // covers back and forward; a pushState route change is not observable without patching
        // history, which this plugin will not do. Call `resetScroll` from the app for those.
        win.addEventListener?.('popstate', () => {
          fired = new Set()
        })

        // Short pages are fully seen on load, so measure once up front.
        measure()
      }

      // ---- Clicks: outbound, contact, downloads ---------------------------
      if (options.trackClicks !== false || options.trackDownloads !== false) {
        // Capture phase, so it runs before the navigation that the click causes.
        root.addEventListener(
          'click',
          (event) => {
            const target = event.target
            if (!target || !(target as Element).closest) return
            const anchor = (target as Element).closest('a')
            if (!anchor) return

            const link = readLink(anchor as HTMLAnchorElement, host)
            if (!link) return

            const isDownload =
              anchor.hasAttribute('download') ||
              (link.fileExtension !== undefined && downloads.has(link.fileExtension))

            if (isDownload) {
              if (options.trackDownloads === false) return
              tracker.track('file_download', {
                file_name: link.fileName,
                file_extension: link.fileExtension,
                link_domain: link.domain,
                link_path: link.path,
                link_text: link.text,
              })
              return
            }

            if (options.trackClicks === false) return
            // Internal navigation is already a RUM view; re-reporting it as an action is noise.
            if (link.type === 'internal') return

            tracker.track('click', {
              link_type: link.type,
              outbound: link.type === 'outbound',
              link_text: link.text,
              // Absent for email and phone: the address is the personal data.
              link_domain: link.domain,
              link_path: link.path,
            })
          },
          { capture: true },
        )
      }

      // ---- Video ----------------------------------------------------------
      if (options.trackVideo !== false) {
        const videoThresholds = [...(options.videoThresholds ?? DEFAULT_VIDEO_THRESHOLDS)].sort((a, b) => a - b)
        const seen = new WeakMap<HTMLVideoElement, Set<number>>()

        const videoOf = (event: Event): HTMLVideoElement | undefined => {
          const target = event.target as HTMLElement | null
          return target?.tagName === 'VIDEO' ? (target as HTMLVideoElement) : undefined
        }

        // `play`, `timeupdate` and `ended` do not bubble, so delegation needs the capture phase.
        root.addEventListener(
          'play',
          (event) => {
            const video = videoOf(event)
            if (!video) return
            const facts = readVideo(video)
            tracker.track('video_start', {
              video_title: facts.title,
              video_provider: facts.provider,
              video_duration: facts.duration,
            })
          },
          { capture: true },
        )

        root.addEventListener(
          'timeupdate',
          (event) => {
            const video = videoOf(event)
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
            const percent = (video.currentTime / video.duration) * 100
            const already = seen.get(video) ?? new Set<number>()

            for (const threshold of videoThresholds) {
              if (percent >= threshold && !already.has(threshold)) {
                already.add(threshold)
                seen.set(video, already)
                tracker.track('video_progress', {
                  video_percent: threshold,
                  video_title: readVideo(video).title,
                })
              }
            }
          },
          { capture: true },
        )

        root.addEventListener(
          'ended',
          (event) => {
            const video = videoOf(event)
            if (!video) return
            tracker.track('video_complete', { video_title: readVideo(video).title })
          },
          { capture: true },
        )
      }

      // ---- Forms ------------------------------------------------------------
      if (options.trackForms !== false) {
        const started = new WeakSet<HTMLFormElement>()
        const leadSelector = options.leadFormSelector ?? '[data-dd-lead], form[data-lead]'

        root.addEventListener('focusin', (event) => {
          const form = (event.target as Element | null)?.closest?.('form') as HTMLFormElement | null
          if (!form || started.has(form)) return
          started.add(form)
          const facts = readForm(form, host)
          tracker.track('form_start', { form_id: facts.id, form_name: facts.name })
        })

        root.addEventListener(
          'submit',
          (event) => {
            const form = event.target as HTMLFormElement | null
            if (!form || form.tagName !== 'FORM') return
            const facts = readForm(form, host)

            tracker.track('form_submit', {
              form_id: facts.id,
              form_name: facts.name,
              form_destination: facts.destination,
            })

            // A form the site has marked as a lead also counts as one. Opt-in by selector, never
            // guessed from field names — guessing would mean reading the fields.
            const isLead = typeof form.matches === 'function' && form.matches(leadSelector)
            if (isLead) {
              tracker.track('generate_lead', { form_id: facts.id, form_name: facts.name })
            }
          },
          { capture: true },
        )
      }

      tracker.logger.info('engagement tracking active')
    },
  }
}

export type { LinkFacts }
export default engagementPlugin
