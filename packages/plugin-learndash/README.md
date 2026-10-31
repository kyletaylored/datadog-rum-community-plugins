# `@kyletaylored/datadog-rum-plugin-learndash`

> A personal community project. **Not provided or supported by Datadog.**

Course enrolment, completed lessons and topics, quiz attempts and scores, and course completion from [LearnDash](https://www.learndash.com/), the WordPress LMS, as Datadog RUM actions in the `learning` family.

## Install

```js
import { datadogRum } from '@datadog/browser-rum'
import { learndashPlugin } from '@kyletaylored/datadog-rum-plugin-learndash'

datadogRum.init({
  applicationId, clientToken, site, service, env, version,
  plugins: [learndashPlugin()],
})
```

CDN, pinned to an exact version with its SRI hash from the release:

```html
<script src="https://www.datadoghq-browser-agent.com/<site>/v7/datadog-rum.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@kyletaylored/datadog-rum-plugin-learndash@0.1.0/dist/plugin.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  DD_RUM.init({ /* ... */, plugins: [DD_RUM_PLUGINS['learndash']()] })
</script>
```

For lesson video, add the [engagement kit](../plugin-engagement/) alongside it. It reads HTML5 video from the page on any platform.

## It needs a server-printed payload

Completing a lesson, a topic or a quiz in LearnDash is a form post that reloads the page, so the browser never sees the moment it happens. The companion WordPress plugin records each one server-side and prints it on the next page as `window.ddRumLearnDash`:

```js
window.ddRumLearnDash = {
  user: { id: 57 },                                   // the WordPress user ID; nothing else
  course: { id: 1204, title: 'Incident response basics' },
  step: { id: 1402, title: 'Status updates check', type: 'quiz' },
  events: [
    { id: 'step-57-1321', type: 'step_complete', step_id: 1321, step_title: 'Severity in practice', step_type: 'topic', progress_percent: 60 },
    { id: 'quiz-57-1402-1', type: 'quiz_graded', quiz_id: 1402, score: 8, score_max: 10, passed: true, attempt: 1 },
  ],
}
```

Each event has an `id`. The plugin reports each one once and remembers it for 24 hours in `dd_rum_learning_seen`, so a reloaded page never counts a completion twice. The full shape is in [`src/types.ts`](src/types.ts).

## What it sends

| LearnDash | Action | Key attributes |
| --- | --- | --- |
| Enrolment | `learning.course_enroll` | `course_id`, `course_name` |
| A lesson or topic marked complete | `learning.lesson_complete` | `lesson_id`, `step_type`, `progress_percent` |
| The quiz's start button clicked | `learning.quiz_start` | `quiz_id`, `quiz_name` |
| A graded attempt | `learning.quiz_complete` | `score`, `score_max`, `passed`, `attempt` |
| Every required step done | `learning.course_complete` | `course_id`, `course_name` |

A quiz reports its score, never the answers. The learner is identified by WordPress user ID only; email and name are never sent, whatever the payload holds.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `identifyUsers` | `true` | Call `setUser` with the WordPress user ID. |
| `consent` | `'auto'` | `auto` waits for a consent plugin, `ignore` skips the gate, or pass a resolver. |
| `quizStartSelector` | `'[name="startQuiz"]'` | The element that starts a quiz attempt. WP Pro Quiz's start button by default. |
| `dataGlobal` | `'ddRumLearnDash'` | Where the server-printed payload lives. |
| `events` | all | Allow-list of learning actions. |
| `beforeTrack` | none | Edit or drop an event before it is sent. |
| `debug` | `false` | Log every mapped event, and every refusal, to the console. |

## Status

The companion WordPress plugin is not published yet, and the fixtures follow the payload contract rather than captures from a live site. The quiz start selector follows WP Pro Quiz's markup and is unconfirmed against LearnDash's own documentation.
