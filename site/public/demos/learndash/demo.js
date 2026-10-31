/**
 * Relay Academy, the LearnDash demo: one course, from enrolment to completion.
 *
 * In LearnDash, enrolling and marking a step complete are form posts that reload the page, and the
 * companion WordPress plugin prints what just happened in `window.ddRumLearnDash` on the next page.
 * This demo plays that server: each action stores the fixture for the page it leads to, and that
 * page prints the fixture's payload before the plugin starts. Everything printed comes from the
 * plugin's recorded fixtures. The one in-page signal, the quiz's start button, is a real click.
 *
 * The engagement kit runs alongside on the lesson page, video only, the way an academy would add
 * it for lesson video. It reads the `<video>` from the page; LearnDash knows nothing about it.
 */
import { startDemo } from '../_shared/bridge.js'

const fixtures = window.DDRumDemoFixtures.learndash
const file = location.pathname.split('/').pop() || 'index.html'

// ---- The course, from the fixtures ------------------------------------------------------------

const enrolled = fixtures['enrols in a course'].payload
const lessonDone = fixtures['completes a lesson'].payload
const topicDone = fixtures['completes a topic'].payload
const quizGraded = fixtures['passes the quiz'].payload.events[0]
const courseDone = fixtures['completes the course'].payload

const LEARNER = lessonDone.user
const COURSE = enrolled.course
/** The step each page shows, read from the fixture that lands there or the event that completes it. */
const stepOf = (event) => ({ id: event.step_id, title: event.step_title, type: event.step_type })
const STEPS = {
  'lesson.html': stepOf(lessonDone.events[0]),
  'severity.html': lessonDone.step,
  'quiz.html': topicDone.step,
  'retro.html': stepOf(courseDone.events[0]),
}

const PAGE_NAMES = {
  'index.html': 'Course',
  'lesson.html': 'Lesson',
  'severity.html': 'Lesson',
  'quiz.html': 'Quiz',
  'results.html': 'Quiz results',
  'retro.html': 'Lesson',
  'complete.html': 'Course complete',
}

/** One per sandbox preset, by id. */
export const scenarios = {
  'a-course-start-to-finish': course(),
  'completion-page-reloaded': [...course(), (d) => d.reload()],
  'cookie-banner-unanswered': course(),
}

const demo = startDemo({
  plugin: 'learndash',
  page: PAGE_NAMES[file],
  defaults: { consent: 'ignore' },
  scenarios,
  alsoCapture: ['engagement'],
})

// ---- The server's half: what this page prints -------------------------------------------------

/**
 * The fixture whose payload this page prints, set by the action that led here. It is kept until
 * the learner moves on, so a reload prints the same events again, as a cached page would. The
 * plugin has reported their IDs already, and refuses them.
 */
const pending = demo.state('pending')
window.ddRumLearnDash = pending
  ? fixtures[pending].payload
  : { user: LEARNER, course: COURSE, ...(STEPS[file] ? { step: STEPS[file] } : {}) }

demo.init(window.DD_RUM_PLUGINS.learndash(demo.options), { source: 'window.ddRumLearnDash' })

if (file === 'lesson.html') {
  const options = demo.options
  demo.init(
    window.DD_RUM_PLUGINS.engagement({
      consent: options.consent,
      debug: true,
      // Video only: the academy adds the kit for its lesson video.
      trackScroll: false,
      trackClicks: false,
      trackDownloads: false,
      trackForms: false,
    }),
    { source: 'the page' },
  )
}

// What the learner has done, for the page to show.
const done = new Set(demo.state('done') ?? [])
for (const event of window.ddRumLearnDash.events ?? []) {
  if (event.type === 'step_complete') done.add(String(event.step_id))
  if (event.type === 'quiz_graded') done.add(String(event.quiz_id))
  if (event.progress_percent !== undefined) demo.state('progress', event.progress_percent)
  if (event.type === 'course_enroll') demo.state('enrolled', true)
}
demo.state('done', [...done])

/** Move on, as the form post and its redirect would, leaving `fixture` for the next page to print. */
function go(href, fixture = null) {
  demo.state('pending', fixture)
  demo.go(href)
}

document.addEventListener('click', (event) => {
  const link = event.target.closest?.('[data-go]')
  if (!link) return
  event.preventDefault()
  go(link.dataset.go)
})

// ---- Pages ------------------------------------------------------------------------------------

if (file === 'index.html') {
  document.querySelector('[data-progress]').textContent = `${demo.state('progress') ?? 0}%`
  for (const item of document.querySelectorAll('[data-step]')) item.classList.toggle('done', done.has(item.dataset.step))
  const isEnrolled = demo.state('enrolled') === true
  document.querySelector('[data-enrol]').hidden = isEnrolled
  document.querySelector('[data-start]').hidden = !isEnrolled
  document.querySelector('[data-enrol]').addEventListener('click', () => go('index.html', 'enrols in a course'))
}

const complete = document.querySelector('[data-complete]')
if (complete) {
  const next = { 'lesson.html': ['severity.html', 'completes a lesson'], 'severity.html': ['quiz.html', 'completes a topic'], 'retro.html': ['complete.html', 'completes the course'] }[file]
  complete.addEventListener('click', () => go(...next))
}

if (file === 'quiz.html') {
  // Starting shows the questions; the plugin hears the click on its own.
  document.querySelector('[data-start-quiz]').addEventListener('click', () => {
    document.querySelector('[data-questions]').hidden = false
  })
  // LearnDash grades on the server; the score on the next page is the recorded one.
  document.querySelector('[data-submit-quiz]').addEventListener('click', () => go('results.html', 'passes the quiz'))
}

if (file === 'results.html') {
  document.querySelector('[data-score]').textContent = `${quizGraded.score} out of ${quizGraded.score_max}`
  document.querySelector('[data-verdict]').textContent = quizGraded.passed ? 'Passed. On to the last lesson.' : 'Not this time.'
}

if (file === 'complete.html') {
  document.querySelector('[data-reload]').addEventListener('click', () => demo.reload())
}

// ---- The lesson video, played by advancing time and firing the element's own events -----------

const video = document.querySelector('[data-video]')
if (video) {
  const DURATION = 90
  let time = 0
  let timer = null
  Object.defineProperty(video, 'duration', { get: () => DURATION, configurable: true })
  Object.defineProperty(video, 'currentTime', { get: () => time, configurable: true })
  const fire = (type) => demo.as(`<video> ${type}`, () => video.dispatchEvent(new Event(type)))
  document.querySelector('[data-play-video]').addEventListener('click', () => {
    if (timer) return
    time = 0
    document.querySelector('[data-video-icon]').textContent = '❚❚'
    fire('play')
    timer = setInterval(() => {
      time = Math.min(DURATION, time + 6)
      document.querySelector('[data-video-progress]').style.width = `${(time / DURATION) * 100}%`
      fire('timeupdate')
      if (time >= DURATION) {
        clearInterval(timer)
        timer = null
        document.querySelector('[data-video-icon]').textContent = '▶'
        fire('ended')
      }
    }, 150)
  })
}

demo.ready()

// ---- Scenarios ----------------------------------------------------------------------------------

/** One learner through the course, driving the real buttons. */
function course() {
  return [
    (d) => d.follow('[data-enrol]'),
    (d) => d.follow('[data-start]'),
    (d) => d.click('[data-play-video]'),
    (d) => d.sleep(2600),
    (d) => d.follow('[data-complete]'),
    (d) => d.follow('[data-complete]'),
    (d) => d.click('[data-start-quiz]'),
    (d) => d.click('[name="q1"][data-answer]'),
    (d) => d.click('[name="q2"][data-answer]'),
    (d) => d.click('[name="q3"][data-answer]'),
    (d) => d.follow('[data-submit-quiz]'),
    (d) => d.follow('[data-continue]'),
    (d) => d.follow('[data-complete]'),
  ]
}

/** Which interaction reaches each action the plugin declares; checked by `npm run lint:demos`. */
export const coverage = {
  reachable: {
    'learning.course_enroll': 'Enrol in this course',
    'learning.lesson_complete': 'Mark complete, on a lesson or a topic',
    'learning.quiz_start': 'Start quiz',
    'learning.quiz_complete': 'Submit answers, on the quiz',
    'learning.course_complete': 'Mark complete, on the last lesson',
  },
}
