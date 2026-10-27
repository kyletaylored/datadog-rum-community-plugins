import type { RuntimeFamily } from './types.js'

export const ACCOUNT_FAMILY: RuntimeFamily = {
  name: 'account',
  prefix: 'account.',
  events: ['login', 'sign_up', 'logout'],
}
