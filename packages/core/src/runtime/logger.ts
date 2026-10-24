/** Debug log. Off by default; when on, it prints every mapped event and the declared footprint. */

export interface Logger {
  enabled: boolean
  event: (name: string, context: Record<string, unknown>) => void
  dropped: (name: string, reason: string) => void
  info: (message: string, detail?: unknown) => void
  warn: (message: string, detail?: unknown) => void
}

export function createLogger(name: string, enabled: boolean): Logger {
  const tag = `[dd-rum:${name}]`
  const console = globalThis.console
  const noop = () => {}

  if (!enabled || !console) {
    return { enabled: false, event: noop, dropped: noop, info: noop, warn: noop }
  }

  return {
    enabled: true,
    event(actionName, context) {
      console.log(`${tag} addAction`, actionName, context)
    },
    dropped(actionName, reason) {
      console.log(`${tag} dropped`, actionName, `(${reason})`)
    },
    info(message, detail) {
      if (detail === undefined) console.log(`${tag} ${message}`)
      else console.log(`${tag} ${message}`, detail)
    },
    warn(message, detail) {
      if (detail === undefined) console.warn(`${tag} ${message}`)
      else console.warn(`${tag} ${message}`, detail)
    },
  }
}
