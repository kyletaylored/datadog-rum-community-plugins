---
'@kyletaylored/datadog-rum-community-plugins': minor
---

Schema 1.2.0 adds the `learning` family, for course platforms: `learning.course_enroll`, `lesson_complete`, `quiz_start`, `quiz_complete` and `course_complete`, with course, lesson and quiz IDs and names, `step_type`, `score`, `score_max`, `passed`, `attempt` and `progress_percent`. Import `LEARNING_FAMILY` into a plugin's tracker. Additive: every 1.1.0 action and attribute is unchanged.
