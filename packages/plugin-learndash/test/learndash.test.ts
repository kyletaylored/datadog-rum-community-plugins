// @vitest-environment jsdom
//
// jsdom, because the quiz start is a click on a real element.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  checkConformance,
  createFakeRum,
  formatFindings,
  installMemoryLocalStorage,
  loadFixtures,
  recordJourney,
  writeEventReport,
  type FakeRum,
  type Fixture,
} from '../../test-harness/src/index.js'
import type { PluginManifest, RumInitConfigurationLike, RumPublicApi } from '@kyletaylored/datadog-rum-community-plugins'
import { FOOTPRINT, learndashPlugin, type LearnDashPayload } from '../src/index.js'

// jsdom replaces import.meta.url, so paths resolve from the repo root (vitest's cwd).
const packageDir = 'packages/plugin-learndash'
const manifest = JSON.parse(readFileSync(`${packageDir}/plugin.json`, 'utf8')) as PluginManifest
const fixtures = loadFixtures(`${packageDir}/fixtures`).flatMap((entry) => entry.fixtures)
const byName = (name: string) => fixtures.find((fixture) => fixture.name === name)!

let restoreStorage: () => void
// Fresh storage per test: the event dedupe is shared state, and a leftover entry from an earlier
// test would look exactly like working deduplication.
beforeEach(() => {
  restoreStorage = installMemoryLocalStorage()
  document.body.innerHTML = ''
})
afterEach(() => restoreStorage())

type Options = Parameters<typeof learndashPlugin>[0]

/**
 * Replays fixtures the way a learner's browser meets them. A `page` fixture is a page load: a
 * fresh plugin reading that page's payload, listening in that page's own root. A `click` lands in
 * the current page.
 */
function browser(options: Options, api: { publicApi: RumPublicApi; initConfiguration: RumInitConfigurationLike }) {
  let page: HTMLElement | undefined
  return async (fixture: Fixture) => {
    if (fixture.event === 'page') {
      page?.remove()
      page = document.createElement('div')
      document.body.append(page)
      await learndashPlugin({ ...options, data: fixture.payload as LearnDashPayload, root: page }).onInit?.(api)
      return
    }
    const host = document.createElement('div')
    host.innerHTML = String((fixture.payload as { html?: string }).html ?? '')
    page?.append(host)
    host.firstElementChild?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }
}

async function run(options: Options = {}, names = fixtures.map((fixture) => fixture.name)) {
  const rum = createFakeRum({})
  const visit = browser({ consent: 'ignore', ...options }, rum)
  for (const name of names) await visit(byName(name))
  return rum
}

const actionNames = (rum: FakeRum) => rum.actions().map((action) => action.name)

describe('learning events', () => {
  it('maps a learner path to the learning schema, in order', async () => {
    const rum = await run()
    expect(actionNames(rum)).toEqual([
      'learning.course_enroll',
      'learning.lesson_complete',
      'learning.lesson_complete',
      'learning.quiz_start',
      'learning.quiz_complete',
      'learning.lesson_complete',
      'learning.course_complete',
    ])
  })

  it('reports a topic as a lesson_complete with its step type and the course progress', async () => {
    const rum = await run()
    expect(rum.actions()[2]?.context).toEqual({
      course_id: '1204',
      course_name: 'Incident response basics',
      lesson_id: '1321',
      lesson_name: 'Severity in practice',
      step_type: 'topic',
      progress_percent: 60,
    })
  })

  it('reports a quiz score and pass, never the answers', async () => {
    const rum = await run()
    const quiz = rum.actions().find((action) => action.name === 'learning.quiz_complete')
    expect(quiz?.context).toEqual({
      course_id: '1204',
      course_name: 'Incident response basics',
      quiz_id: '1402',
      quiz_name: 'Status updates check',
      score: 8,
      score_max: 10,
      passed: true,
      attempt: 1,
    })
    expect(JSON.stringify(rum.calls)).not.toContain('answers')
  })

  it('starts the quiz from the click, with the quiz the page shows', async () => {
    const rum = await run()
    expect(rum.actions().find((action) => action.name === 'learning.quiz_start')?.context).toEqual({
      course_id: '1204',
      quiz_id: '1402',
      quiz_name: 'Status updates check',
    })
  })

  it('ignores the start button on a page that is not a quiz', async () => {
    const rum = await run({}, ['completes a lesson', 'starts the quiz'])
    expect(actionNames(rum)).not.toContain('learning.quiz_start')
  })

  it('takes a theme’s own quiz start selector', async () => {
    const rum = createFakeRum({})
    const page = document.createElement('div')
    document.body.append(page)
    await learndashPlugin({ consent: 'ignore', root: page, quizStartSelector: '.begin', data: byName('completes a topic').payload as LearnDashPayload }).onInit?.(rum)
    page.innerHTML = '<button class="begin">Begin</button><input name="startQuiz">'
    page.querySelector('[name="startQuiz"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    page.querySelector('.begin')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(actionNames(rum).filter((name) => name === 'learning.quiz_start')).toHaveLength(1)
  })
})

describe('each event once', () => {
  it('does not report a completion again when the page is reloaded', async () => {
    const rum = await run({}, ['completes the course', 'completes the course'])
    expect(actionNames(rum)).toEqual(['learning.lesson_complete', 'learning.course_complete'])
  })

  it('drops an event with no id, since it could not be reported only once', async () => {
    const rum = createFakeRum({})
    await learndashPlugin({ consent: 'ignore', data: { events: [{ type: 'course_enroll', course_id: 1 } as never] } }).onInit?.(rum)
    expect(rum.actions()).toHaveLength(0)
  })
})

describe('identity and privacy', () => {
  it('identifies the learner by WordPress user ID only, never email or name', async () => {
    const rum = await run({}, ['enrols in a course'])
    expect(rum.calls).toContainEqual({ api: 'setUser', user: { id: '57' } })
    expect(JSON.stringify(rum.calls)).not.toContain('learner@example.com')
    expect(JSON.stringify(rum.calls)).not.toContain('Sam Learner')
  })

  it('sends nothing until consent is granted', async () => {
    const rum = createFakeRum({})
    const visit = browser({}, rum)
    for (const fixture of fixtures) await visit(fixture)
    expect(rum.initConfiguration.trackingConsent).toBe('not-granted')
    expect(rum.actions()).toHaveLength(0)
    expect(rum.calls.some((call) => call.api === 'setUser')).toBe(false)
  })
})

describe('conformance', () => {
  it('declares the footprint the manifest does', () => {
    expect(manifest.footprint.globals).toEqual(FOOTPRINT.globals)
    expect(manifest.footprint.events).toEqual(FOOTPRINT.events)
    expect(manifest.footprint.storageKeys).toEqual(FOOTPRINT.storageKeys)
  })

  it('passes the shared suite over every fixture', async () => {
    const rum = await run()
    expect(formatFindings(checkConformance({ manifest, rum }))).toBe('conformance: ok')
  })

  it('matches the committed snapshot, and generates the published event list', async () => {
    const rum = await run()
    expect(rum.actions()).toMatchSnapshot()
    const options = { consent: 'ignore' as const }
    const journey = await recordJourney({
      platform: 'learndash',
      journey: manifest.journey,
      fixtures,
      options,
      start: (api) => browser({ ...options, debug: true }, api),
    })
    writeEventReport(packageDir, 'learndash', rum, journey)
  })
})
