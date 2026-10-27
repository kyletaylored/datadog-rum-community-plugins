import type { RuntimeFamily } from './types.js'

export const LEAD_FAMILY: RuntimeFamily = {
  name: 'lead',
  prefix: 'lead.',
  events: ['generate_lead'],
}
