/**
 * Kiro Web — entry point.
 *
 * Process layout (single Node process, two HTTP listeners):
 *   - ProxyServer        port 19080  →  /v1/*, /v1beta/*, /metrics, /admin/*
 *                                       reverse proxy + API key auth
 *   - Fastify (admin)    port 19081  →  /api/*       (web UI backend)
 *                                       /             (static SPA, when built)
 *                                       /login         (admin login page)
 *
 * Both share one Store (~/.kiro-web/kiro-accounts.json by default) and one
 * AccountPool. Restart of the proxy server is handled in-process via
 * ProxyServer.stop() + .start() without exiting Node.
 */
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { ProxyServer } from './proxy/proxyServer.js'
import type { ProxyAccount, ProxyConfig, ApiKey } from './proxy/types.js'
import { getStore } from './utils/store.js'
import { getDataDir } from './utils/dataDir.js'
import { proxyLogger } from './proxy/logger.js'
import { registerAccountsApi } from './api/accounts.js'
import { registerKeysApi } from './api/keys.js'
import { registerProxyApi } from './api/proxy.js'
import { registerAuthApi } from './api/auth.js'
import { registerLogsApi } from './api/logs.js'
import { registerStaticUi } from './api/static.js'
import { refreshTokenByMethod } from './utils/tokenRefresh.js'
import { startTokenAutoRefresh } from './utils/autoRefresh.js'
import { startUsageAutoRefresh } from './utils/autoUsageRefresh.js'

interface PersistedSnapshot {
  accounts?: ProxyAccount[]
  apiKeys?: ApiKey[]
  proxyConfig?: Partial<ProxyConfig>
  adminPassword?: string
  // arbitrary extras (settings, webhooks...) preserved verbatim
  [k: string]: unknown
}

function defaultProxyConfig(): ProxyConfig {
  return {
    enabled: true,
    port: Number(process.env.PROXY_PORT || 19080),
    host: process.env.PROXY_HOST || '0.0.0.0',
    apiKeys: [],
    enableMultiAccount: true,
    selectedAccountIds: [],
    logRequests: true,
    logStreamEvents: false,
    maxConcurrent: 10,
    maxRetries: 3,
    retryDelayMs: 1000,
    preferredEndpoint: 'codewhisperer',
    tokenRefreshBeforeExpiry: 300,
    autoStart: true,
    accountSelectionStrategy: 'round-robin',
    multiAccountSelectionMode: 'all',
    autoSwitchOnQuotaExhausted: true,
    enableTokenBufferReserve: false,
    payloadSizeLimitKB: 4096,
  }
}

async function main() {
  proxyLogger.info('Kiro-Web', `Data directory: ${getDataDir()}`)

  // ---------------- Storage ----------------
  const store = getStore()
  const snapshot = store.get<PersistedSnapshot>('accountData', {}) ?? {}
  const accounts: ProxyAccount[] = snapshot.accounts ?? []
  const apiKeys: ApiKey[] = (snapshot.apiKeys ?? []).map(k => ({
    // Migrate any pre-existing key that was created before we initialized
    // usage; ProxyServer.recordApiKeyUsage assumes the struct exists.
    ...k,
    usage: k.usage || {
      totalRequests: 0,
      totalCredits: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      daily: {},
    },
  }))
  const persistedProxyCfg = snapshot.proxyConfig ?? {}

  proxyLogger.info('Kiro-Web', `Loaded ${accounts.length} accounts, ${apiKeys.length} api keys`)

  // ---------------- ProxyServer ----------------
  const proxyConfig: ProxyConfig = { ...defaultProxyConfig(), ...persistedProxyCfg, apiKeys }
  const proxyServer = new ProxyServer(proxyConfig, {
    onAccountUpdate: (acc) => {
      // ProxyServer mutates an account in place when it refreshes the access
      // token / profile ARN. Persist only those mutable runtime fields back
      // into the store — DO NOT spread the whole `acc` because the in-memory
      // ProxyAccount has a smaller schema than what we keep on disk
      // (subscription / usage / idp etc. would be lost on every refresh).
      const all = store.get<PersistedSnapshot>('accountData', {}) ?? {}
      const list = (all.accounts ?? []).map(a => {
        if (a.id !== acc.id) return a
        return {
          ...a,
          accessToken: acc.accessToken ?? a.accessToken,
          refreshToken: acc.refreshToken ?? a.refreshToken,
          expiresAt: acc.expiresAt ?? a.expiresAt,
          profileArn: acc.profileArn ?? a.profileArn,
          quotaUsed: acc.quotaUsed ?? a.quotaUsed,
          quotaLimit: acc.quotaLimit ?? a.quotaLimit,
          quotaResetAt: acc.quotaResetAt ?? a.quotaResetAt,
          suspendedAt: acc.suspendedAt ?? a.suspendedAt,
          lastUsed: acc.lastUsed ?? a.lastUsed,
          requestCount: acc.requestCount ?? a.requestCount,
          errorCount: acc.errorCount ?? a.errorCount,
        }
      })
      store.set('accountData', { ...all, accounts: list })
    },
    onTokenRefresh: async (account) => {
      try {
        const r = await refreshTokenByMethod(
          account.refreshToken || '',
          account.clientId || '',
          account.clientSecret || '',
          account.region || 'us-east-1',
          account.authMethod,
          account.proxyUrl,
        )
        if (r.success && r.accessToken) {
          return {
            success: true,
            accessToken: r.accessToken,
            refreshToken: r.refreshToken,
            expiresAt: Date.now() + (r.expiresIn || 3600) * 1000,
          }
        }
        return { success: false, error: r.error || 'Token refresh failed' }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  // Seed AccountPool with persisted accounts so it can route requests on start.
  const pool = proxyServer.getAccountPool()
  for (const acc of accounts) {
    if (acc.enabled !== false) pool.addAccount(acc)
  }

  // Blacklist on N consecutive failures: flip enabled=false on disk and pull
  // the account out of the live pool. Manual re-enable from the UI puts it
  // back via the existing PUT /api/accounts/:id path.
  pool.setBlacklistHandler((accountId, reason) => {
    const all = store.get<PersistedSnapshot>('accountData', {}) ?? {}
    const list = (all.accounts ?? []).map(a =>
      a.id === accountId ? { ...a, enabled: false } : a
    )
    store.set('accountData', { ...all, accounts: list })
    pool.removeAccount(accountId)
    const acc = list.find(a => a.id === accountId)
    proxyLogger.warn('Kiro-Web', `Blacklisted account ${acc?.email || accountId}: ${reason}`)
  })

  if (proxyConfig.autoStart && accounts.length > 0) {
    try {
      await proxyServer.start()
      proxyLogger.info('Kiro-Web', `Proxy listening on ${proxyConfig.host}:${proxyConfig.port}`)
    } catch (err) {
      proxyLogger.error('Kiro-Web', `Proxy failed to start: ${(err as Error).message}`)
    }
  } else {
    proxyLogger.info('Kiro-Web', 'Proxy not auto-started (no accounts or autoStart=false)')
  }

  // ---------------- Admin / UI Fastify ----------------
  const adminPort = Number(process.env.ADMIN_PORT || 19081)
  const adminHost = process.env.ADMIN_HOST || '0.0.0.0'

  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info', transport: { target: 'pino-pretty', options: { colorize: true } } },
    bodyLimit: 50 * 1024 * 1024,
  })

  await fastify.register(cookie, { secret: process.env.COOKIE_SECRET || 'kiro-web-default-secret-change-me' })
  await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })

  // Health check (open).
  fastify.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }))

  // Public auth routes (login/logout).
  await registerAuthApi(fastify, store)

  // Protected /api/* routes.
  await registerAccountsApi(fastify, store, proxyServer)
  await registerKeysApi(fastify, store, proxyServer)
  await registerProxyApi(fastify, store, proxyServer)
  await registerLogsApi(fastify)

  // Static SPA (catch-all, last).
  await registerStaticUi(fastify)

  try {
    await fastify.listen({ port: adminPort, host: adminHost })
    proxyLogger.info('Kiro-Web', `Admin UI listening on http://${adminHost}:${adminPort}`)
  } catch (err) {
    proxyLogger.error('Kiro-Web', `Admin server failed: ${(err as Error).message}`)
    process.exit(1)
  }

  // Background task: keep idle accounts' tokens fresh so the UI doesn't
  // show "Token 已过期" the next time the user opens the page. ProxyServer
  // already refreshes on-demand for /v1/* traffic.
  const autoRefreshTimer = startTokenAutoRefresh(store, proxyServer)

  // Background task: poll upstream getUsageLimits every 5 min so the credits
  // / usage% on the account cards stay live. Without this they freeze on
  // whatever value /api/accounts/:id/query-subscription last wrote.
  const usageRefreshTimer = startUsageAutoRefresh(store, proxyServer)

  // Graceful shutdown.
  const shutdown = async (sig: string) => {
    proxyLogger.info('Kiro-Web', `Received ${sig}, shutting down...`)
    clearInterval(autoRefreshTimer)
    clearInterval(usageRefreshTimer)
    try {
      await proxyServer.stop(2000)
    } catch {}
    try {
      await fastify.close()
    } catch {}
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch(err => {
  console.error('FATAL', err)
  process.exit(1)
})
