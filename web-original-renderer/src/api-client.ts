/**
 * Web build replacement for the Electron `window.api` bridge.
 *
 * The renderer was originally written against an `ipcRenderer.invoke(...)`
 * contract exposed by src/preload/index.ts. In the Electron app each method
 * round-trips to the main process; here we route the same logical operations
 * over HTTP to the Fastify admin server (`/api/*`).
 *
 * Goals
 *   - Keep the React code unchanged. Pages call `window.api.loadAccounts()`,
 *     etc. — the implementation here just makes those work over fetch.
 *   - Anything that has no Web equivalent (kproxy, registration, IDE-local
 *     file mutations) returns a clear "not supported in web" error so the UI
 *     surfaces it instead of hanging.
 *   - Realtime progress events (background-batch-refresh / -check) are
 *     wired through Server-Sent Events when the backend exposes them; the
 *     fallback is polling-free no-ops while the backend SSE endpoints are
 *     stubbed.
 *
 * Storage shape parity: the Electron Manager stored everything as a single
 * 'accountData' object inside electron-store. We mirror that so existing
 * components that call `loadAccounts()` -> `accountData` keep working.
 */

type Json = unknown

async function http<T = Json>(method: string, path: string, body?: unknown, isForm?: boolean): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    init.body = isForm ? (body as FormData) : JSON.stringify(body)
  }
  const res = await fetch(path, init)
  if (!res.ok) {
    let msg = `${method} ${path} failed: HTTP ${res.status}`
    try {
      const data = await res.json() as { error?: string }
      if (data?.error) msg = data.error
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return await res.json() as T
  return undefined as T
}

const NOT_SUPPORTED = (feature: string) => () => {
  return Promise.reject(new Error(`${feature} is not available in the web build`))
}
const NOT_SUPPORTED_SYNC = (feature: string) => () => {
  console.warn(`${feature} is not available in the web build`)
}
const noopCleanup = () => () => {}

// --- Auth state polled by the layout ---
async function whoami(): Promise<{ authenticated: boolean }> {
  try {
    return await http<{ authenticated: boolean }>('GET', '/api/auth/me')
  } catch {
    return { authenticated: false }
  }
}

export const api = {
  // ===== Auth =====
  webLogin: async (password: string) => http('POST', '/api/auth/login', { password }),
  webLogout: async () => http('POST', '/api/auth/logout'),
  webWhoAmI: whoami,
  webChangePassword: async (newPassword: string) =>
    http('POST', '/api/auth/change-password', { newPassword }),

  // ===== App-level (mostly placeholders for web) =====
  openExternal: (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  getAppVersion: async () => '0.1.0-web',
  onAuthCallback: noopCleanup,

  // ===== Accounts =====
  // Existing renderer expects loadAccounts() to return the same blob the
  // Electron app stored under store.get('accountData'). We compose it from
  // /api/accounts and /api/keys so renderer-side code that reads
  // `data.accounts` / `data.apiKeys` works untouched.
  loadAccounts: async () => {
    const [a, k] = await Promise.all([
      http<{ accounts: unknown[] }>('GET', '/api/accounts'),
      http<{ keys: unknown[] }>('GET', '/api/keys'),
    ])
    return { accounts: a.accounts, apiKeys: k.keys }
  },
  saveAccounts: async (data: { accounts?: unknown[]; apiKeys?: unknown[] }) => {
    if (Array.isArray(data?.accounts)) {
      await http('PUT', '/api/accounts', { accounts: data.accounts })
    }
    // apiKeys saved via dedicated endpoints; bulk PUT not exposed yet.
    return { success: true }
  },

  refreshAccountToken: async (_account: unknown) => {
    // The web build refreshes tokens lazily on outbound proxy traffic; an
    // explicit refresh endpoint can be added later. Until then surface a
    // gentle error so the caller can fall back.
    return { success: false, error: 'refresh-on-demand not yet exposed in web build' }
  },
  checkAccountStatus: async (_account: unknown) => {
    return { success: false, error: 'check-status not yet exposed in web build' }
  },

  // SSE-driven batch operations not yet wired; React stores degrade gracefully.
  backgroundBatchRefresh: NOT_SUPPORTED('backgroundBatchRefresh'),
  backgroundBatchCheck: NOT_SUPPORTED('backgroundBatchCheck'),
  onBackgroundRefreshProgress: noopCleanup,
  onBackgroundRefreshResult: noopCleanup,
  onBackgroundCheckProgress: noopCleanup,
  onBackgroundCheckResult: noopCleanup,

  // Account import: renderer normally hands a parsed object; in web we
  // route through the multipart upload endpoint.
  importFromFile: async () => ({ success: false, error: 'use the Upload button to choose a JSON file' }),
  importFromSsoToken: NOT_SUPPORTED('SSO-token import (use JSON file)'),
  exportToFile: async (data: unknown) => {
    // Pure browser download — no backend round-trip.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kiro-export-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { success: true }
  },

  // Web-only convenience to drive the multipart upload.
  webUploadAccountsFile: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return http('POST', '/api/accounts/import', fd, true)
  },

  // ===== Account → Proxy binding (per-account egress proxy) =====
  accountSetProxyBinding: NOT_SUPPORTED('account proxy binding'),

  // ===== Subscription / quota (Kiro upstream) =====
  // These were thin wrappers over kiroApi.ts which we kept on the server,
  // but the dedicated endpoints are not yet implemented. UI degrades to
  // showing "n/a" if the calls reject.
  accountGetModels: NOT_SUPPORTED('accountGetModels'),
  accountGetSubscriptions: NOT_SUPPORTED('accountGetSubscriptions'),
  accountGetSubscriptionUrl: NOT_SUPPORTED('accountGetSubscriptionUrl'),
  accountSetOverage: NOT_SUPPORTED('accountSetOverage'),

  // ===== Switch / logout / SSO (Electron only) =====
  switchAccount: NOT_SUPPORTED('switchAccount (desktop only)'),
  switchAccountCli: NOT_SUPPORTED('switchAccountCli (desktop only)'),
  logoutAccount: NOT_SUPPORTED('logoutAccount (desktop only)'),

  // ===== Reverse proxy lifecycle =====
  proxyStart: async () => {
    await http('POST', '/api/proxy/start')
    return { success: true }
  },
  proxyStop: async () => {
    await http('POST', '/api/proxy/stop')
    return { success: true }
  },
  proxyRestart: async () => {
    await http('POST', '/api/proxy/restart')
    return { success: true }
  },
  proxyGetStatus: async () => {
    return await http('GET', '/api/proxy/status')
  },
  proxyGetConfig: async () => http('GET', '/api/proxy/config'),
  proxySaveConfig: async (cfg: unknown) => http('PUT', '/api/proxy/config', cfg),
  proxyNeedsRestart: async () => {
    const s = await http<{ needsRestart?: boolean }>('GET', '/api/proxy/status')
    return { needsRestart: !!s?.needsRestart }
  },
  proxyResetStats: async () => http('POST', '/api/proxy/reset-stats'),

  // ===== Logs =====
  proxyTailLog: async (lines = 200) => http(`GET`, `/api/logs/tail?lines=${lines}`),

  // ===== Catch-all stub for any other window.api.foo() the React code
  // happens to call. We log and reject so missing wiring is visible.
  // This is added at runtime via Proxy below.
}

type ApiShape = typeof api & Record<string, unknown>

const apiProxy = new Proxy(api as ApiShape, {
  get(target, key: string) {
    if (key in target) return (target as Record<string, unknown>)[key]
    // Heuristic: methods starting with "on" usually subscribe to events.
    if (key.startsWith('on') || key.startsWith('off')) return noopCleanup
    return (...args: unknown[]) => {
      console.warn(`[web/api] window.api.${key}(...) not implemented in web build`, args)
      return Promise.reject(new Error(`${key} is not available in the web build`))
    }
  },
})

declare global {
  interface Window {
    api: ApiShape
    electron?: unknown
  }
}

window.api = apiProxy
window.electron = {
  ipcRenderer: {
    on: () => {},
    off: () => {},
    send: () => {},
    invoke: NOT_SUPPORTED('ipcRenderer.invoke (desktop only)'),
  },
}
