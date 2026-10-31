/**
 * Behaviour for the Relay page, shared by the engagement demo and the OneTrust demo on top of it.
 *
 * Nothing here calls the plugin. The page is ordinary markup: real anchors, a real form and a
 * real `<video>`, and the engagement plugin reads it through its own DOM listeners. This file only
 * keeps the visitor inside the demo (links and the form are not followed) and plays the video.
 */

/** What an interaction carried that must not arrive, read from the element itself. */
function carried(element) {
  const anchor = element.closest?.('a[href]')
  if (anchor) {
    const href = anchor.getAttribute('href')
    if (/^(mailto|tel|sms):/i.test(href)) return 'the address itself is not sent'
    const url = new URL(anchor.href)
    if (url.search) {
      const names = [...url.searchParams.keys()].map((name) => `${name}=…`).join('&')
      return `query string dropped: ?${names}`
    }
    return undefined
  }
  const form = element.closest?.('form')
  if (form) {
    const names = [...form.querySelectorAll('input[name]')].map((input) => input.name)
    return names.length > 0 ? `${names.join(', ')}: field values are never read` : undefined
  }
  return undefined
}

export function wireRelay(demo) {
  // Attribute what the visitor does to the element they did it on. Capture on window runs
  // before the plugin's capture listener on document, so the context is set in time.
  window.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href]')
    if (anchor) demo.during('link click', { stripped: carried(anchor) })
  }, true)
  window.addEventListener('focusin', (event) => {
    if (event.target.closest?.('form')) demo.during('form focusin', { stripped: carried(event.target) })
  }, true)
  window.addEventListener('submit', (event) => {
    demo.during('form submit', { stripped: carried(event.target) })
  }, true)

  // Keep the visitor in the demo. Bubble phase, so the plugin has already seen the click.
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href]')
    if (anchor && !anchor.getAttribute('href').startsWith('#')) event.preventDefault()
  })
  const form = document.querySelector('[data-form]')
  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    form.querySelector('[data-subscribe]').textContent = 'Subscribed ✓'
  })

  // ---- The video ------------------------------------------------------------------------------
  const video = document.querySelector('[data-video]')
  const icon = document.querySelector('[data-video-icon]')
  const bar = document.querySelector('[data-video-progress]')
  const DURATION = 120
  let time = 0
  let timer = null
  Object.defineProperty(video, 'duration', { get: () => DURATION, configurable: true })
  Object.defineProperty(video, 'currentTime', { get: () => time, configurable: true })

  const fire = (type) => demo.as(`<video> ${type}`, () => video.dispatchEvent(new Event(type)))

  document.querySelector('[data-play-video]').addEventListener('click', () => {
    if (timer) return
    if (time >= DURATION) time = 0
    icon.textContent = '❚❚'
    fire('play')
    // Two minutes of video in about three seconds, in the steps a browser reports progress in.
    timer = setInterval(() => {
      time = Math.min(DURATION, time + 6)
      bar.style.width = `${(time / DURATION) * 100}%`
      fire('timeupdate')
      if (time >= DURATION) {
        clearInterval(timer)
        timer = null
        icon.textContent = '▶'
        fire('ended')
      }
    }, 150)
  })
}

/** Scenario steps shared by both Relay demos. */
export const relaySteps = {
  watchVideo: [(d) => d.click('[data-play-video]'), (d) => d.sleep(3400)],
  secrets: [(d) => d.click('[data-link="token"]'), (d) => d.click('[data-link="download"]')],
  form: [(d) => d.type('[data-email]', 'jane@company.example'), (d) => d.click('[data-subscribe]')],
}
