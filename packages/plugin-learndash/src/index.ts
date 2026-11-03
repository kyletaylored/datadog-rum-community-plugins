import {
  createDedupe,
  createTracker,
  LEARNING_FAMILY,
  type CommonPluginOptions,
  type PluginFootprint,
  type RumPlugin,
  type Tracker,
} from '@kyletaylored/datadog-rum-community-plugins'
import type { LearnDashEvent, LearnDashPayload } from './types.js'

export const PLUGIN_VERSION = '0.1.0'

/** Where the companion WordPress plugin prints the learner, the page and what just happened. */
export const DATA_GLOBAL = 'ddRumLearnDash'

/** Each learning event is reported once per browser, the way a purchase is. */
export const SEEN_STORAGE_KEY = 'dd_rum_learning_seen'

/**
 * The quiz's start button. LearnDash renders quizzes with WP Pro Quiz, whose start button is an
 * input named `startQuiz`. Overridable, because a theme can restyle or replace it.
 */
export const DEFAULT_QUIZ_START_SELECTOR = '[name="startQuiz"]'

export const FOOTPRINT: PluginFootprint = {
  globals: [`window.${DATA_GLOBAL}`, 'document'],
  events: ['click'],
  storageKeys: [SEEN_STORAGE_KEY],
  rumApis: ['addAction', 'setGlobalContextProperty', 'setUser'],
  consentSource: null,
}

export interface LearnDashPluginOptions extends CommonPluginOptions {
  /** Where to read the server-printed payload. Defaults to `window.ddRumLearnDash`. */
  dataGlobal?: string
  /** Supply the payload directly instead of reading a global. Used in tests and headless setups. */
  data?: LearnDashPayload
  /** The element that starts a quiz attempt. Defaults to WP Pro Quiz's `[name="startQuiz"]`. */
  quizStartSelector?: string
  /** Listen for the quiz start somewhere other than `document`. Used by the tests. */
  root?: Document | HTMLElement
}

function readGlobal(name: string): LearnDashPayload | undefined {
  const value = (globalThis as Record<string, unknown>)[name]
  return value && typeof value === 'object' ? (value as LearnDashPayload) : undefined
}

const id = (value: unknown) => (value === undefined || value === null || value === '' ? undefined : String(value))

/**
 * Course, lesson and quiz events from LearnDash, the WordPress LMS.
 *
 * Completing a lesson or a quiz in LearnDash is a form post that reloads the page, so the browser
 * never sees the moment it happens. The companion WordPress plugin records each one server-side
 * and prints it on the next page in `window.ddRumLearnDash.events`, each with its own `id`. The
 * plugin reports each event once, and remembers its ID for 24 hours so a reload does not report it
 * again. The one thing that does happen in the page, starting a quiz, it reads from the click.
 */
export function learndashPlugin(options: LearnDashPluginOptions = {}): RumPlugin {
  return {
    name: 'learndash',
    onInit({ initConfiguration, publicApi }) {
      const tracker = createTracker({
        platform: 'learndash',
        version: PLUGIN_VERSION,
        publicApi,
        families: [LEARNING_FAMILY],
        initConfiguration,
        options,
        footprint: FOOTPRINT,
      })
      const seen = createDedupe({ namespace: 'learndash', storageKey: SEEN_STORAGE_KEY })

      const data = options.data ?? readGlobal(options.dataGlobal ?? DATA_GLOBAL)

      const userId = id(data?.user?.id)
      if (userId) tracker.identify({ id: userId })

      for (const event of data?.events ?? []) {
        const eventId = id(event.id)
        if (!eventId) {
          tracker.logger.dropped(event.type, 'no event id, cannot report it only once')
        } else if (!seen.claim(eventId)) {
          tracker.logger.dropped(event.type, `already reported event ${eventId}`)
        } else {
          report(tracker, event, data)
        }
      }

      // Starting a quiz is the one step that happens in the page rather than on a form post.
      const step = data?.step
      const doc = (globalThis as { document?: Document }).document
      const root = options.root ?? doc
      if (step?.type === 'quiz' && root) {
        const selector = options.quizStartSelector ?? DEFAULT_QUIZ_START_SELECTOR
        root.addEventListener(
          'click',
          (click) => {
            if (!(click.target as Element | null)?.closest?.(selector)) return
            tracker.track('quiz_start', { course_id: id(data?.course?.id), quiz_id: id(step.id), quiz_name: step.title })
          },
          { capture: true },
        )
      }

      tracker.logger.info(`reported ${data?.events?.length ?? 0} LearnDash events from the page`)
    },
  }
}

/** Map one server-recorded event onto the learning schema. */
function report(tracker: Tracker, event: LearnDashEvent, page: LearnDashPayload | undefined): void {
  const course = { course_id: id(event.course_id ?? page?.course?.id), course_name: event.course_title ?? page?.course?.title }
  switch (event.type) {
    case 'course_enroll':
      tracker.track('course_enroll', course)
      break
    case 'step_complete':
      tracker.track('lesson_complete', {
        ...course,
        lesson_id: id(event.step_id),
        lesson_name: event.step_title,
        step_type: event.step_type,
        progress_percent: event.progress_percent,
      })
      break
    case 'quiz_graded':
      tracker.track('quiz_complete', {
        ...course,
        quiz_id: id(event.quiz_id),
        quiz_name: event.quiz_title,
        score: event.score,
        score_max: event.score_max,
        passed: event.passed,
        attempt: event.attempt,
      })
      break
    case 'course_complete':
      tracker.track('course_complete', course)
      break
    default:
      tracker.logger.dropped(String((event as { type?: unknown }).type), 'no schema event for this LearnDash event')
  }
}

export type { LearnDashEvent, LearnDashPayload } from './types.js'
export default learndashPlugin
