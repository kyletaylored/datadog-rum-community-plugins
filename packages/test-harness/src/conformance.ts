import {
  allActionNames,
  FAMILIES,
  ITEM_FIELDS,
  MAX_ITEMS,
  MAX_STRING_LENGTH,
  SCHEMA_VERSION,
  actionSpec,
  familyOf,
  isBlockedKey,
  type PluginManifest,
} from '@kyletaylored/datadog-rum-community-plugins'
import type { FakeRum, RecordedCall } from './fakePublicApi.js'

export interface ConformanceFinding {
  rule: string
  detail: string
}

export interface ConformanceResult {
  ok: boolean
  findings: ConformanceFinding[]
  checked: { actions: number; calls: number }
}

export interface ConformanceInput {
  manifest: PluginManifest
  /** The recorded run to inspect: every call the adapter made across all its fixtures. */
  rum: FakeRum
  /** Options the adapter ran with, so opt-in rules are judged against what was asked for. */
  options?: { includeEmail?: boolean; includeName?: boolean; includeItems?: boolean; actionPrefix?: string }
}

const PII_USER_KEYS = ['email', 'name', 'phone', 'address'] as const

/**
 * The shared suite from the PRD. Every adapter runs it with no extra code: action names against
 * the family's allowed list, attribute names and types against the schema, no PII unless opted
 * in, size caps, one `commerce.purchase` per `transaction_id`, nothing before consent, and a
 * manifest footprint that matches what the run actually did.
 */
export function checkConformance(input: ConformanceInput): ConformanceResult {
  const { manifest, rum } = input
  const options = input.options ?? {}
  const findings: ConformanceFinding[] = []
  const fail = (rule: string, detail: string) => findings.push({ rule, detail })

  const prefix = options.actionPrefix ?? 'commerce.'
  const actions = rum.actions()

  // ---- Action names -------------------------------------------------------
  const allowedNames = new Set(allActionNames())
  if (prefix !== 'commerce.') {
    for (const action of FAMILIES.commerce.actions) allowedNames.add(`${prefix}${action.event}`)
  }

  for (const action of actions) {
    if (!allowedNames.has(action.name)) {
      fail('action-names', `"${action.name}" is not an action name in schema ${SCHEMA_VERSION}`)
      continue
    }
    const bare = action.name.slice(action.name.indexOf('.') + 1)
    const family = familyOf(bare)
    // A renamed prefix applies only to commerce; other families keep their own.
    if (family && family.family !== 'commerce' && !action.name.startsWith(family.prefix)) {
      fail('action-names', `"${action.name}" belongs to the ${family.family} family and must keep the "${family.prefix}" prefix`)
    }
  }

  if (manifest.actions) {
    const declared = new Set(manifest.actions)
    for (const action of actions) {
      const bare = action.name.slice(action.name.indexOf('.') + 1)
      const family = familyOf(bare)
      const canonical = family ? `${family.prefix}${bare}` : action.name
      if (!declared.has(canonical)) {
        fail('manifest-actions', `the run emitted ${canonical}, which plugin.json does not declare`)
      }
    }
  }

  // ---- Attributes ---------------------------------------------------------
  for (const action of actions) {
    const bare = action.name.slice(action.name.indexOf('.') + 1)
    const spec = actionSpec(bare)
    const family = familyOf(bare)
    if (!spec || !family) continue

    for (const [key, value] of Object.entries(action.context)) {
      if (isBlockedKey(key)) {
        fail('pii-filter', `${action.name} sent the blocked attribute "${key}"`)
        continue
      }

      const attribute = family.attributes[key]
      if (!attribute) {
        fail('attribute-names', `${action.name} sent "${key}", which is not in the ${family.family} schema`)
        continue
      }

      const typeError = checkType(attribute.type, value)
      if (typeError) fail('attribute-types', `${action.name}.${key}: ${typeError}`)
    }

    // ---- Size caps --------------------------------------------------------
    const items = action.context.items
    if (Array.isArray(items)) {
      if (!options.includeItems) {
        fail('items-opt-in', `${action.name} sent items[] while includeItems is off`)
      }
      if (items.length > MAX_ITEMS) {
        fail('size-caps', `${action.name} sent ${items.length} items, over the cap of ${MAX_ITEMS}`)
      }
      for (const item of items) {
        if (!item || typeof item !== 'object') {
          fail('attribute-types', `${action.name}.items contains a non-object entry`)
          continue
        }
        for (const key of Object.keys(item as Record<string, unknown>)) {
          if (!(ITEM_FIELDS as readonly string[]).includes(key)) {
            fail('attribute-names', `${action.name}.items[].${key} is not a GA4 item field`)
          }
        }
      }
    }

    for (const tooLong of longStrings(action.context)) {
      fail('size-caps', `${action.name}.${tooLong.path} is ${tooLong.length} characters, over the cap of ${MAX_STRING_LENGTH}`)
    }
  }

  // ---- Purchase dedupe ----------------------------------------------------
  const purchaseIds = actions
    .filter((action) => action.name.endsWith('.purchase'))
    .map((action) => action.context.transaction_id)

  for (const [id, seen] of countBy(purchaseIds)) {
    if (id === undefined) {
      fail('purchase-dedupe', 'a purchase was sent with no transaction_id, so revenue cannot be deduplicated')
    } else if (seen > 1) {
      fail('purchase-dedupe', `transaction_id ${String(id)} produced ${seen} purchase actions; it must fire once`)
    }
  }

  // ---- Identity PII -------------------------------------------------------
  for (const call of rum.calls) {
    if (call.api !== 'setUser' && call.api !== 'setAccount') continue
    const payload = call.api === 'setUser' ? call.user : call.account
    for (const key of Object.keys(payload)) {
      if (key === 'id') continue
      if (key === 'email' && !options.includeEmail) {
        fail('pii-opt-in', `${call.api} sent email while includeEmail is off`)
      } else if (key === 'name' && !options.includeName) {
        fail('pii-opt-in', `${call.api} sent name while includeName is off`)
      } else if (isBlockedKey(key) || (PII_USER_KEYS as readonly string[]).includes(key)) {
        if (key !== 'email' && key !== 'name') {
          fail('pii-opt-in', `${call.api} sent "${key}", which is never allowed`)
        }
      }
    }
  }

  // ---- Consent ordering ---------------------------------------------------
  const grantIndex = rum.calls.findIndex(
    (call) => call.api === 'setTrackingConsent' && call.consent === 'granted',
  )
  const hasConsentSource = manifest.footprint.consentSource !== null
  if (hasConsentSource && grantIndex !== -1) {
    const early = rum.calls
      .slice(0, grantIndex)
      .filter((call) => call.api === 'addAction' || call.api === 'setUser')
    if (early.length > 0) {
      fail(
        'consent-gate',
        `${early.length} call(s) were made before consent was granted: ${early.map(describe).join(', ')}`,
      )
    }
  }

  // ---- Manifest and footprint --------------------------------------------
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    fail('manifest-schema', `plugin.json declares schema ${manifest.schemaVersion}; the core ships ${SCHEMA_VERSION}`)
  }

  const observedApis = rum.apisUsed()
  const declaredApis = new Set(manifest.footprint.rumApis)
  for (const api of observedApis) {
    if (!declaredApis.has(api)) {
      fail('footprint', `the run called ${api}, which plugin.json's footprint does not declare`)
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    checked: { actions: actions.length, calls: rum.calls.length },
  }
}

function checkType(type: string, value: unknown): string | undefined {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? undefined : `expected a string, got ${typeName(value)}`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : `expected a finite number, got ${typeName(value)} (numbers must not be strings, so they can become RUM measures)`
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? undefined
        : `expected an integer, got ${typeName(value)}`
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `expected a boolean, got ${typeName(value)}`
    case 'items':
      return Array.isArray(value) ? undefined : `expected an array, got ${typeName(value)}`
    default:
      return undefined
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function longStrings(value: unknown, path = ''): { path: string; length: number }[] {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? [{ path: path || '(root)', length: value.length }] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => longStrings(entry, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => longStrings(nested, path ? `${path}.${key}` : key))
  }
  return []
}

function countBy<T>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function describe(call: RecordedCall): string {
  return call.api === 'addAction' ? `addAction(${call.name})` : call.api
}

/** Render findings as a single readable assertion message. */
export function formatFindings(result: ConformanceResult): string {
  if (result.ok) return 'conformance: ok'
  return [
    `conformance: ${result.findings.length} finding(s) across ${result.checked.calls} recorded call(s)`,
    ...result.findings.map((finding) => `  [${finding.rule}] ${finding.detail}`),
  ].join('\n')
}
