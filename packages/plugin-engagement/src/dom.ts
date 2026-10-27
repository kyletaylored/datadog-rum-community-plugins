/**
 * DOM readers. Everything here is written to answer one question: what is the smallest fact about
 * this interaction that is still useful?
 *
 * A href is the obvious trap. GA4 sends `link_url`, but a URL can carry a session token, a reset
 * code or an email in its query string — and a `mailto:` or `tel:` href *is* the personal data.
 * So these helpers never return a whole URL, never return a query string, and reduce contact
 * links to their kind.
 */

export type LinkType = 'outbound' | 'email' | 'phone' | 'internal'

export interface LinkFacts {
  type: LinkType
  domain?: string
  path?: string
  text?: string
  fileName?: string
  fileExtension?: string
}

/**
 * Default set: the extensions a marketing or product team actually asks about. Kept short on
 * purpose — a long tail of formats costs bundle size on every page load and mostly produces false
 * positives, and anything missing can be added with `downloadExtensions`. An explicit `download`
 * attribute is honoured whatever the extension.
 */
export const DEFAULT_DOWNLOAD_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'zip', 'mp3', 'mp4',
] as const

/** Visible link text, collapsed and capped. The core truncates again at 256. */
export function linkText(element: Element): string | undefined {
  const raw = (element as HTMLElement).innerText ?? element.textContent ?? ''
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text !== '') return text.slice(0, 120)
  // An icon-only link has no text; fall back to its accessible label, never to the href.
  const label = element.getAttribute('aria-label') ?? element.getAttribute('title')
  return label ? label.replace(/\s+/g, ' ').trim().slice(0, 120) : undefined
}

/**
 * Read a clicked anchor. Returns `undefined` for links that say nothing useful (fragment-only,
 * javascript:, empty).
 */
export function readLink(anchor: HTMLAnchorElement, currentHost: string): LinkFacts | undefined {
  const href = anchor.getAttribute('href')
  if (!href) return undefined

  const scheme = href.slice(0, href.indexOf(':') + 1).toLowerCase()

  // The address is the personal data, so only its kind is reported.
  if (scheme === 'mailto:') return { type: 'email', text: linkText(anchor) }
  if (scheme === 'tel:' || scheme === 'sms:') return { type: 'phone', text: linkText(anchor) }
  if (scheme === 'javascript:' || href.startsWith('#')) return undefined

  let parsed: URL
  try {
    parsed = new URL(anchor.href)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined

  // Path only: the query string and fragment are dropped, never truncated-and-sent.
  const path = parsed.pathname || '/'
  const fileName = path.slice(path.lastIndexOf('/') + 1) || undefined
  const dot = fileName ? fileName.lastIndexOf('.') : -1
  const fileExtension = dot > 0 ? fileName!.slice(dot + 1).toLowerCase() : undefined

  return {
    type: parsed.host === currentHost ? 'internal' : 'outbound',
    domain: parsed.host,
    path,
    text: linkText(anchor),
    fileName,
    fileExtension,
  }
}

/** Percentage of the document scrolled, 0-100. */
export function scrollDepth(doc: Document, win: Window): number {
  const element = doc.documentElement
  const scrollable = Math.max(
    element.scrollHeight - win.innerHeight,
    (doc.body?.scrollHeight ?? 0) - win.innerHeight,
    0,
  )
  // A page shorter than the viewport is fully seen the moment it loads.
  if (scrollable <= 0) return 100
  const scrolled = win.scrollY || element.scrollTop || 0
  return Math.min(100, Math.max(0, Math.round((scrolled / scrollable) * 100)))
}

export interface VideoFacts {
  title?: string
  provider: string
  duration?: number
}

/** Title comes from the element's own labelling, never from a URL or file name. */
export function readVideo(video: HTMLVideoElement): VideoFacts {
  const title =
    video.getAttribute('title') ??
    video.getAttribute('aria-label') ??
    video.getAttribute('data-title') ??
    undefined
  return {
    title: title ? title.replace(/\s+/g, ' ').trim().slice(0, 120) : undefined,
    provider: 'html5',
    duration: Number.isFinite(video.duration) ? Math.round(video.duration) : undefined,
  }
}

export interface FormFacts {
  id?: string
  name?: string
  destination?: string
}

/** Identity of a form, never its contents. No input is read, at any point. */
export function readForm(form: HTMLFormElement, currentHost: string): FormFacts {
  const id = form.getAttribute('id') ?? form.getAttribute('name') ?? undefined
  const label = form.getAttribute('aria-label') ?? undefined
  let destination: string | undefined

  const action = form.getAttribute('action')
  if (action) {
    try {
      destination = new URL(action, `https://${currentHost}`).host
    } catch {
      destination = undefined
    }
  }

  return {
    id: id?.slice(0, 120),
    name: label ? label.replace(/\s+/g, ' ').trim().slice(0, 120) : undefined,
    destination,
  }
}
