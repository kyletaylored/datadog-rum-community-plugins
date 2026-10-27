import type { RuntimeFamily } from './types.js'

export const SUPPORT_FAMILY: RuntimeFamily = {
  name: 'support',
  prefix: 'support.',
  events: ['chat_opened'],
}
