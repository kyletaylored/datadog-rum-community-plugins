/**
 * Reads the asset pack in `assets/` at build time, so a plugin page can say where its actions
 * show up in Datadog without anyone writing it down: which generated metrics a plugin's actions
 * feed, which dashboard widgets read those metrics, and which monitors watch them.
 *
 * Matching is on `@action.name:<name>` in each metric's filter, the same string Datadog matches.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface GeneratedMetric {
  /** Terraform resource name, e.g. `orders`. */
  resource: string
  /** Metric name, e.g. `rum.commerce.orders`. */
  name: string
  aggregation: 'count' | 'distribution'
  /** The attribute a distribution is computed from, e.g. `@context.value`. */
  path?: string
  /** The action it counts, when its filter names one. */
  action?: string
}

export interface QueryValueWidget {
  title: string
  /** The widget's formula with each query replaced by the metric it reads. */
  formula: string
  metrics: string[]
}

export interface DashboardSummary {
  title: string
  queryValues: QueryValueWidget[]
  funnel?: { title: string; steps: string[] }
  metrics: string[]
}

export interface MonitorSummary {
  name: string
  query: string
}

/** The repo root, found by walking up from wherever the build runs. */
function assetsDir(): string {
  let dir = resolve(process.cwd())
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, 'assets/terraform/generated-metrics.tf')
    if (existsSync(candidate)) return join(dir, 'assets')
    dir = dirname(dir)
  }
  throw new Error('assets/ not found above the working directory')
}

const read = (path: string) => readFileSync(join(assetsDir(), path), 'utf8')

/** Every `datadog_rum_metric` in the Terraform. Parsed by brace depth, which is all HCL needs here. */
export function generatedMetrics(): GeneratedMetric[] {
  const source = read('terraform/generated-metrics.tf')
  const metrics: GeneratedMetric[] = []
  const start = /resource\s+"datadog_rum_metric"\s+"([^"]+)"\s*\{/g
  let match: RegExpExecArray | null
  while ((match = start.exec(source))) {
    let depth = 1
    let index = start.lastIndex
    while (depth > 0 && index < source.length) {
      if (source[index] === '{') depth += 1
      if (source[index] === '}') depth -= 1
      index += 1
    }
    const body = source.slice(start.lastIndex, index)
    const name = /\bname\s*=\s*"([^"]+)"/.exec(body)?.[1]
    if (!name) continue
    const aggregation = /aggregation_type\s*=\s*"([^"]+)"/.exec(body)?.[1]
    metrics.push({
      resource: match[1]!,
      name,
      aggregation: aggregation === 'distribution' ? 'distribution' : 'count',
      path: /\bpath\s*=\s*"(@[^"]+)"/.exec(/compute\s*\{[^}]*\}/.exec(body)?.[0] ?? '')?.[1],
      action: /@action\.name:([\w.]+)/.exec(body)?.[1],
    })
  }
  return metrics
}

/** The metrics fed by any of these actions. */
export function metricsFor(actions: string[]): GeneratedMetric[] {
  return generatedMetrics().filter((metric) => metric.action !== undefined && actions.includes(metric.action))
}

type Widget = { definition: { type: string; title?: string; widgets?: Widget[]; requests?: Request[] } }
type Request = { formulas?: { formula: string; alias?: string }[]; queries?: { name: string; query?: string }[] }

function flatten(widgets: Widget[]): Widget[] {
  return widgets.flatMap((widget) => [widget, ...flatten(widget.definition.widgets ?? [])])
}

/** `rum.commerce.revenue.sum` → `revenue.sum`: the part a reader needs once the family is known. */
export function shortMetric(name: string): string {
  return name.replace(/^rum\.[a-z]+\./, '')
}

export function dashboard(file = 'dashboards/commerce-overview.json'): DashboardSummary {
  const parsed = JSON.parse(read(file)) as { title: string; widgets: Widget[] }
  const all = flatten(parsed.widgets)
  const metricsIn = (query = '') => [...query.matchAll(/(rum\.[a-z_]+\.[a-z_]+(?:\.[a-z]+)?)\{/g)].map((found) => found[1]!)

  const queryValues = all
    .filter((widget) => widget.definition.type === 'query_value')
    .map((widget) => {
      const request = widget.definition.requests?.[0] ?? {}
      const names = new Map((request.queries ?? []).map((query) => [query.name, metricsIn(query.query)[0]]))
      const formula = (request.formulas?.[0]?.formula ?? '').replace(/query\d+/g, (name) => shortMetric(names.get(name) ?? name))
      return { title: widget.definition.title ?? '', formula, metrics: [...names.values()].filter((value): value is string => Boolean(value)) }
    })

  const funnelWidget = all.find((widget) => /^funnel/i.test(widget.definition.title ?? ''))
  const funnel = funnelWidget
    ? {
        title: funnelWidget.definition.title!,
        steps: (funnelWidget.definition.requests ?? []).flatMap((request) => (request.formulas ?? []).map((formula) => formula.alias ?? formula.formula)),
      }
    : undefined

  const metrics = [...new Set(all.flatMap((widget) => (widget.definition.requests ?? []).flatMap((request) => (request.queries ?? []).flatMap((query) => metricsIn(query.query)))))]
  return { title: parsed.title, queryValues, funnel, metrics }
}

export function monitors(file = 'monitors/commerce-monitors.json'): MonitorSummary[] {
  return (JSON.parse(read(file)) as { name: string; query: string }[]).map((monitor) => ({ name: monitor.name, query: monitor.query }))
}
