/**
 * The console log. Per-event lines (every mapped event, every drop) need `debug: true`.
 * Warnings do not: a warning means the install is misconfigured or stuck, which a default install
 * must be able to see, so each distinct warning prints once per page whatever `debug` says.
 */

export interface Logger {
  enabled: boolean
  event: (name: string, context: Record<string, unknown>) => void
  dropped: (name: string, reason: string) => void
  info: (message: string, detail?: unknown) => void
  /** Always printed, once per distinct message. */
  warn: (message: string, detail?: unknown) => void
}

export function createLogger(name: string, enabled: boolean): Logger {
  const tag = `[dd-rum:${name}]`
  const console = globalThis.console
  const noop = () => {}
  const warned = new Set<string>()

  const print = (level: 'log' | 'warn', message: string, detail?: unknown) => {
    if (detail === undefined) console[level](`${tag} ${message}`)
    else console[level](`${tag} ${message}`, detail)
  }

  const warn = (message: string, detail?: unknown) => {
    if (!console || warned.has(message)) return
    warned.add(message)
    print('warn', message, detail)
  }

  if (!enabled || !console) {
    return { enabled: false, event: noop, dropped: noop, info: noop, warn }
  }

  return {
    enabled: true,
    event(actionName, context) {
      console.log(`${tag} addAction`, actionName, context)
    },
    dropped(actionName, reason) {
      console.log(`${tag} dropped`, actionName, `(${reason})`)
    },
    info: (message, detail) => print('log', message, detail),
    warn,
  }
}
