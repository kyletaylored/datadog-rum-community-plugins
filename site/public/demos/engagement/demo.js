/**
 * Relay, the engagement demo: a SaaS marketing page with nothing instrumented.
 *
 * The engagement plugin starts against the recorder and reads the page through its own DOM
 * listeners: scroll, link clicks, the `<video>` and the newsletter form. This file never tells
 * it what happened.
 */
import { startDemo } from '../_shared/bridge.js'
import { relaySteps, wireRelay } from '../_shared/relay.js'

/** One per sandbox preset, by id. */
export const scenarios = {
  'a-visit-end-to-end': visit(),
  'links-carrying-secrets': [(d) => d.scrollTo(0.35), ...relaySteps.secrets],
  'a-form-with-personal-data-in-it': [(d) => d.scrollTo(0.8), ...relaySteps.form],
  'cookie-banner-unanswered': visit(),
}

const demo = startDemo({
  plugin: 'engagement',
  page: 'Home',
  defaults: { consent: 'ignore' },
  scenarios,
  // Scroll depth is measured a frame after the scroll, outside any handler the demo can see.
  sourceFor: (call) => (call.label === 'engagement.scroll' ? 'scroll depth, measured on scroll' : undefined),
})

wireRelay(demo)
demo.init(window.DD_RUM_PLUGINS.engagement(demo.options), { source: 'the page' })
demo.ready()

function visit() {
  return [
    (d) => d.scrollTo(0.5),
    (d) => d.click('[data-link="hero-pricing"]'),
    (d) => d.click('[data-link="hero-trial"]'),
    ...relaySteps.watchVideo,
    (d) => d.scrollTo(0.6),
    ...relaySteps.secrets,
    (d) => d.scrollTo(0.85),
    ...relaySteps.form,
    (d) => d.scrollTo(1),
    (d) => d.click('[data-link="email"]'),
    (d) => d.click('[data-link="phone"]'),
  ]
}

/** Which interaction reaches each action the plugin declares; checked by `npm run lint:demos`. */
export const coverage = {
  reachable: {
    'engagement.scroll': 'scrolling past 25, 50, 75 and 90%',
    'engagement.click': 'Pricing ↗, the shared status page link, the email and phone links',
    'engagement.file_download': 'Download the Q3 report (PDF)',
    'engagement.video_start': 'playing the video',
    'engagement.video_progress': 'the video passing 10, 25, 50 and 75%',
    'engagement.video_complete': 'the video ending',
    'engagement.form_start': 'focusing the newsletter email field',
    'engagement.form_submit': 'Subscribe',
    'lead.generate_lead': 'Subscribe, because the form is marked data-lead',
  },
}
