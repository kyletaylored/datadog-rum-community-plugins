import type { PluginFootprint } from './types.js'

/** The shape of `plugin.json`, validated in CI against `schema/plugin-manifest.schema.json`. */
export interface PluginManifest {
  name: string
  package: string
  /** The factory this package exports, e.g. `wooCommercePlugin`. Used verbatim in install snippets. */
  exportName: string
  version: string
  family: 'commerce' | 'engagement' | 'consent' | 'identity' | 'support' | 'lead'
  title?: string
  description: string
  maintainer: { name: string; github: string }
  tier: 'seed' | 'verified' | 'listed'
  schemaVersion: string
  rumSdk: string
  platforms?: { name: string; versions?: string; notes?: string }[]
  install?: { npm?: boolean; cdn?: boolean; platform?: string }
  actions?: string[]
  /**
   * One visitor's path, in order. Each step names a fixture; the snapshot test replays them and the
   * plugin page renders what each step sent. A fixture may repeat, e.g. a reloaded thank-you page.
   */
  journey: { label: string; fixture: string }[]
  options?: { name: string; type?: string; default: unknown; description: string }[]
  footprint: PluginFootprint
  demo?: string
  docs?: string
}
