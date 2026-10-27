/**
 * The runtime shape of a family: its name, its prefix and the events it defines.
 *
 * One module per family, so a plugin importing only `COMMERCE` does not drag the engagement or
 * support event names into its CDN bundle. Before this split the tracker read a single map of
 * every family, which meant adding a family silently taxed every plugin's bundle — and adding the
 * engagement family pushed two of them over the 5 KB budget at once.
 */
export interface RuntimeFamily {
  readonly name: 'commerce' | 'engagement' | 'account' | 'lead' | 'support'
  readonly prefix: string
  readonly events: readonly string[]
}
