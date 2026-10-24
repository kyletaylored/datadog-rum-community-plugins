/**
 * The site is served from `/datadog-rum-community-plugins/`, so nothing may link to an absolute
 * path. Every internal href goes through here.
 */
const base = import.meta.env.BASE_URL.replace(/\/$/, '')

export function url(path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}

/** jsDelivr URL for an adapter's CDN build. Always exact-version; never `latest`. */
export function cdnUrl(pkg: string, version: string): string {
  return `https://cdn.jsdelivr.net/npm/${pkg}@${version}/dist/plugin.js`
}
