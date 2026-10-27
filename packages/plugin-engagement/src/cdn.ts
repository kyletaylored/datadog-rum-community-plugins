// CDN entry: registers on window.DD_RUM_PLUGINS['engagement']().
import { engagementPlugin } from './index.js'

const registry = ((globalThis as Record<string, unknown>).DD_RUM_PLUGINS ??= {}) as Record<string, unknown>
registry['engagement'] = engagementPlugin

export { engagementPlugin }
