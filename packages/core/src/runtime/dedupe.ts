/**
 * `commerce.purchase` fires once per `transaction_id` per browser, so a refreshed thank-you page
 * does not double-count revenue. State lives in `localStorage` for 24 hours, with an in-memory
 * fallback when storage is unavailable (private mode, blocked cookies, sandboxed iframes).
 */

export const DEDUPE_STORAGE_KEY = 'dd_rum_commerce_seen'
export const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000
/** Enough for a busy session without letting the entry grow without bound. */
const MAX_ENTRIES = 50

type SeenMap = Record<string, number>

export interface Dedupe {
  /** Records the key and returns true the first time it is seen, false afterwards. */
  claim: (key: string) => boolean
  /** Storage keys this instance may write, for the declared footprint. */
  storageKeys: string[]
}

function readStore(storage: Storage | undefined, key: string): SeenMap {
  if (!storage) return {}
  try {
    const raw = storage.getItem(key)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: SeenMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeStore(storage: Storage | undefined, key: string, value: SeenMap): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled: the in-memory map still prevents duplicates this page.
  }
}

function resolveStorage(): Storage | undefined {
  try {
    const storage = globalThis.localStorage
    if (!storage) return undefined
    // Safari in private mode exposes localStorage but throws on write.
    const probe = '__dd_rum_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return undefined
  }
}

export interface DedupeOptions {
  /** Namespace, so two adapters on one page don't collide. */
  namespace: string
  storageKey?: string
  ttlMs?: number
  now?: () => number
  storage?: Storage | null
}

export function createDedupe(options: DedupeOptions): Dedupe {
  const storageKey = options.storageKey ?? DEDUPE_STORAGE_KEY
  const ttlMs = options.ttlMs ?? DEDUPE_TTL_MS
  const now = options.now ?? (() => Date.now())
  const storage = options.storage === null ? undefined : (options.storage ?? resolveStorage())
  const memory = new Set<string>()

  return {
    storageKeys: storage ? [storageKey] : [],
    claim(key: string): boolean {
      const scoped = `${options.namespace}:${key}`
      if (memory.has(scoped)) return false
      memory.add(scoped)

      const seen = readStore(storage, storageKey)
      const cutoff = now() - ttlMs
      let changed = false

      for (const [entry, at] of Object.entries(seen)) {
        if (at < cutoff) {
          delete seen[entry]
          changed = true
        }
      }

      if (seen[scoped] !== undefined) {
        if (changed) writeStore(storage, storageKey, seen)
        return false
      }

      seen[scoped] = now()

      const entries = Object.entries(seen)
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => b[1] - a[1])
        for (const [entry] of entries.slice(MAX_ENTRIES)) delete seen[entry]
      }

      writeStore(storage, storageKey, seen)
      return true
    },
  }
}
