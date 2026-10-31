import type { RuntimeFamily } from './types.js'

export const LEARNING_FAMILY: RuntimeFamily = {
  name: 'learning',
  prefix: 'learning.',
  events: ['course_enroll', 'lesson_complete', 'quiz_start', 'quiz_complete', 'course_complete'],
}
