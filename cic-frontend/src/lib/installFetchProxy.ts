/**
 * Global `window.fetch` proxy.
 *
 * Why this exists
 * ---------------
 * Many older components in this codebase make API calls via raw `fetch`:
 *
 *     fetch('/api/foo', {
 *       headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
 *     })
 *
 * Two things about that pattern broke in production:
 *
 *   1. The relative URL `/api/foo` is resolved against the current origin —
 *      the frontend static site. The static site's SPA-fallback rewrite
 *      returns `index.html` for any unknown path, so the call resolves to
 *      HTML instead of JSON and the caller blows up with
 *      `JSON.parse: unexpected character '<'`.
 *   2. Auth moved to an HttpOnly cookie months ago, so the dead
 *      `Authorization: Bearer null` header carries no auth and the cookie
 *      isn't attached because `credentials` defaults to `'same-origin'`.
 *
 * Rather than refactor every component (~20 sites), this proxy normalises
 * the call at the platform layer:
 *
 *   • Any `/api/*` or `/socket.io/*` URL is rewritten to the absolute
 *     backend origin from `VITE_API_URL`.
 *   • `credentials: 'include'` is set so the HttpOnly cookie travels with
 *     every cross-origin request.
 *
 * Calls that already use an absolute URL or pass explicit `credentials`
 * are left untouched.
 */

export interface InstallFetchProxyOptions {
  /**
   * The backend origin, with or without a trailing `/api`. Defaults to
   * `import.meta.env.VITE_API_URL`. If that is empty or a same-origin
   * relative path (e.g. `/api`), the proxy becomes a no-op for URL
   * rewriting and only ensures `credentials: 'include'`.
   */
  apiUrl?: string
}

const RELATIVE_API_PATHS = /^\/(api|socket\.io)(\/|$|\?)/

export function installFetchProxy(options: InstallFetchProxyOptions = {}): void {
  if (typeof window === 'undefined' || !window.fetch) return

  // Detect already-installed proxy so HMR or duplicate imports don't wrap
  // the wrapper recursively.
  if ((window.fetch as unknown as { __claimsflowProxied?: boolean }).__claimsflowProxied) {
    return
  }

  const rawApiUrl =
    options.apiUrl ??
    (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_URL ??
    ''

  // Strip a trailing `/api` so we can construct the absolute base cleanly.
  // Anything that isn't an absolute http(s) URL means "use current origin"
  // and we do not rewrite — the caller is expected to already be same-origin.
  const isAbsolute = /^https?:\/\//i.test(rawApiUrl)
  const origin = isAbsolute ? rawApiUrl.replace(/\/api\/?$/, '') : ''

  const original = window.fetch.bind(window)

  const proxied: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const isApiPath = typeof url === 'string' && RELATIVE_API_PATHS.test(url)

    let nextInput: RequestInfo | URL = input
    let nextInit: RequestInit | undefined = init

    if (isApiPath) {
      // Rewrite URL to point at the absolute backend, but only if we have
      // one configured. Otherwise leave it alone — the caller is expected
      // to be relying on a same-origin proxy at the edge.
      if (origin) {
        const absolute = `${origin}${url}`
        nextInput =
          typeof input === 'string' ? absolute : input instanceof URL ? new URL(absolute) : new Request(absolute, input)
      }

      // Always include credentials for API calls so the HttpOnly auth
      // cookie travels with the request.
      nextInit = { ...(init ?? {}) }
      if (!nextInit.credentials) nextInit.credentials = 'include'
    }

    return original(nextInput, nextInit)
  }

  ;(proxied as unknown as { __claimsflowProxied: boolean }).__claimsflowProxied = true
  window.fetch = proxied
}
