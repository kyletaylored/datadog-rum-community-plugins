---
'@kyletaylored/datadog-rum-plugin-learndash': minor
---

New plugin for LearnDash, the WordPress LMS: `learning.course_enroll`, `lesson_complete` (lessons and topics), `quiz_start`, `quiz_complete` (score, pass, attempt, never the answers) and `course_complete`. Completions come from a payload the companion WordPress plugin prints, `window.ddRumLearnDash`, and each event is reported once per browser by its ID. The quiz start comes from the start button's click. The learner is identified by WordPress user ID only. Pair it with the engagement kit for lesson video.
