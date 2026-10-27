import type { RuntimeFamily } from './types.js'

export const ENGAGEMENT_FAMILY: RuntimeFamily = {
  name: 'engagement',
  prefix: 'engagement.',
  events: [
    'scroll',
    'click',
    'file_download',
    'video_start',
    'video_progress',
    'video_complete',
    'form_start',
    'form_submit',
  ],
}
