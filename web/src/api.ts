/**
 * Tiny fetch helper for the admin API. Uses cookie-based session auth.
 */
async function http<T = unknown>(method: string, path: string, body?: unknown, isForm?: boolean): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
  }
  // Only set content-type when we actually have a JSON body to send. Fastify
  // rejects POST with content-type: application/json + empty body as 400
  // FST_ERR_CTP_EMPTY_JSON_BODY, which would silently break "no-body" actions
  // like /api/proxy/restart and /api/proxy/reset-stats.
  if (body !== undefined) {
    if (isForm) {
      init.body = body as FormData
    } else {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
  }
  const res = await fetch(path, init)
  if (!res.ok) {
    // Server-side `sessions` Map is in-memory, so a process restart silently
    // invalidates every browser cookie. Without this hook, AccountsView (and
    // friends) would catch the 401, render "暂无账号", and the user would have
    // no idea their session had expired. Bounce them back to /login.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('kiro-web:unauthorized'))
    }
    let msg = `${method} ${path}: HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) msg = data.error
    } catch {}
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await res.json()) as T
  return undefined as T
}

export interface AccountSubscription {
  type?: string         // 'Pro' / 'Enterprise' / 'Free'...
  title?: string        // 'KIRO PRO' / 'KIRO POWER'...
  daysRemaining?: number
  expiresAt?: number    // Unix ms
  managementTarget?: string
  upgradeCapability?: string
  overageCapability?: string
}

export interface AccountUsage {
  current?: number
  limit?: number
  percentUsed?: number   // 0..1 from export, 0..100 if normalized
  baseLimit?: number
  baseCurrent?: number
  freeTrialLimit?: number
  freeTrialCurrent?: number
  nextResetDate?: string | number
  lastUpdated?: number
  bonuses?: unknown[]
  resourceDetail?: { displayName?: string; currency?: string; overageRate?: number }
}

export interface Account {
  id: string
  email?: string
  nickname?: string
  enabled?: boolean
  authMethod?: string
  provider?: string
  idp?: string
  region?: string
  profileArn?: string
  expiresAt?: number       // accessToken expiry (Unix ms)
  quotaUsed?: number
  quotaLimit?: number
  quotaResetAt?: number
  suspendedAt?: number
  status?: string
  createdAt?: number
  lastUsedAt?: number
  // Display-only extras lifted from the original Manager export.
  subscription?: AccountSubscription
  usage?: AccountUsage
}

export interface ApiKey {
  id: string
  name: string
  key: string
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  totalRequests?: number
  totalTokens?: number
}

export interface RecentRequest {
  timestamp: number
  path: string
  model: string
  accountId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  credits?: number
  responseTime: number
  success: boolean
  error?: string
  statusCode?: number
  attempts?: number
  accountChain?: string[]
}

export interface UsageEvent {
  timestamp: number
  inputTokens: number
  outputTokens: number
  credits?: number
}

export interface ProxyStatus {
  running: boolean
  config: { port: number; host: string; enabled: boolean; enableMultiAccount: boolean }
  stats: {
    totalRequests: number
    successRequests: number
    failedRequests: number
    totalTokens: number
    totalCredits?: number
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
    retriedRequests?: number
    totalAccountSwitches?: number
    startTime?: number
    recentRequests?: RecentRequest[]
    usage24h?: UsageEvent[]
  }
  session: { totalRequests: number; successRequests: number; failedRequests: number; startTime: number }
}

export const api = {
  // auth
  whoami: () => http<{ authenticated: boolean }>('GET', '/api/auth/me'),
  login: (password: string) => http<{ ok: true }>('POST', '/api/auth/login', { password }),
  logout: () => http('POST', '/api/auth/logout'),
  changePassword: (newPassword: string) => http('POST', '/api/auth/change-password', { newPassword }),

  // accounts
  listAccounts: () => http<{ accounts: Account[] }>('GET', '/api/accounts'),
  putAccounts: (accounts: Account[]) => http('PUT', '/api/accounts', { accounts }),
  updateAccount: (id: string, updates: Partial<Account>) => http('PUT', `/api/accounts/${id}`, updates),
  deleteAccount: (id: string) => http('DELETE', `/api/accounts/${id}`),
  importAccountsFile: (files: File | File[]) => {
    const fd = new FormData()
    const list = Array.isArray(files) ? files : [files]
    // The backend reads `req.parts()` so the field name doesn't matter, but
    // keeping `files[]` makes the intent obvious in the network panel.
    for (const f of list) fd.append('files[]', f, f.name)
    return http<{ ok: true; added: number; updated: number; total: number; fileErrors?: { name: string; error: string }[] }>(
      'POST',
      '/api/accounts/import',
      fd,
      true,
    )
  },
  importAccountsPaste: (json: string) =>
    http<{ ok: true; added: number; updated: number; total: number; fileErrors?: { name: string; error: string }[] }>(
      'POST',
      '/api/accounts/import-paste',
      { json },
    ),
  refreshAccount: (id: string) => http<{ ok: true; expiresAt?: number }>('POST', `/api/accounts/${id}/refresh`),
  querySubscription: (id: string) => http<{ ok: boolean; data?: unknown; error?: string }>('POST', `/api/accounts/${id}/query-subscription`),
  testAccount: (id: string) => http<{ ok: boolean; modelCount?: number; models?: string[]; error?: string }>('POST', `/api/accounts/${id}/test`),

  // api keys
  listKeys: () => http<{ keys: ApiKey[] }>('GET', '/api/keys'),
  createKey: (name: string) => http<{ ok: true; key: ApiKey }>('POST', '/api/keys', { name }),
  updateKey: (id: string, updates: Partial<ApiKey>) => http('PUT', `/api/keys/${id}`, updates),
  deleteKey: (id: string) => http('DELETE', `/api/keys/${id}`),

  // proxy
  proxyStatus: () => http<ProxyStatus>('GET', '/api/proxy/status'),
  proxyStart: () => http('POST', '/api/proxy/start'),
  proxyStop: () => http('POST', '/api/proxy/stop'),
  proxyRestart: () => http('POST', '/api/proxy/restart'),
  resetStats: () => http('POST', '/api/proxy/reset-stats'),

  // logs
  tailLog: (lines = 200) => http<{ lines: string[] }>('GET', `/api/logs/tail?lines=${lines}`),
}
