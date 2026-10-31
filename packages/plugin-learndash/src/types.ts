/**
 * What the companion WordPress plugin prints as `window.ddRumLearnDash`.
 *
 * LearnDash completes lessons and quizzes with form posts that reload the page, so the server is
 * the only place those moments are known. It prints the learner, the page they are on, and the
 * learning events recorded since their last page view, each with an `id` the browser reports once.
 */
export interface LearnDashPayload {
  /** The WordPress user ID. Only the ID: no email, no name. */
  user?: { id?: string | number }
  course?: { id?: string | number; title?: string }
  /** The lesson, topic or quiz the page shows. */
  step?: { id?: string | number; title?: string; type?: 'lesson' | 'topic' | 'quiz' }
  events?: LearnDashEvent[]
}

interface EventBase {
  /** Unique per event, e.g. `enroll-12-1204`. Reported once per browser for 24 hours. */
  id: string
  course_id?: string | number
  course_title?: string
}

export type LearnDashEvent =
  | (EventBase & { type: 'course_enroll' | 'course_complete' })
  | (EventBase & {
      type: 'step_complete'
      step_id?: string | number
      step_title?: string
      step_type?: 'lesson' | 'topic'
      /** The learner's course progress after the step, 0-100. */
      progress_percent?: number
    })
  | (EventBase & {
      type: 'quiz_graded'
      quiz_id?: string | number
      quiz_title?: string
      score?: number
      score_max?: number
      passed?: boolean
      attempt?: number
    })
