/**
 * Background token refresher.
 *
 * ProxyServer already refreshes a token lazily right before a /v1/* request
 * needs it (via the onTokenRefresh callback). That covers active accounts but
 * leaves idle accounts with an expired access_token sitting in storage —
 * which the UI reports as "Token 已过期" and the user has to click ↻ for.
 *
 * This module runs once at startup and then every 30 min, finding accounts
 * whose accessToken expires within 5 min and refreshing them in parallel.
 * Successes are persisted back to the same store the import path writes to.
 */
import type { ProxyServer } from '../proxy/proxyServer.js'
import type { ProxyAccount } from '../proxy/types.js'
import { Store } from './store.js'
import { refreshTokenByMethod } from './tokenRefresh.js'
import { proxyLogger } from '../proxy/logger.js'

const REFRESH_PERIOD_MS = 30 * 60 * 1000   // 30 min
const REFRESH_AHEAD_MS = 5 * 60 * 1000     // refresh tokens that expire within 5 min
const STARTUP_DELAY_MS = 10 * 1000         // small grace period after boot

interface Snapshot {
  accounts?: ProxyAccount[]
  [k: string]: unknown
}

export function startTokenAutoRefresh(store: Store, proxy: ProxyServer): NodeJS.Timeout {
  const tick = async () => {
    try {
      await refreshExpiringTokens(store, proxy)
    } catch (err) {
      proxyLogger.warn('AutoRefresh', `tick failed: ${(err as Error).message}`)
    }
  }
  setTimeout(tick, STARTUP_DELAY_MS)
  return setInterval(tick, REFRESH_PERIOD_MS)
}

async function refreshExpiringTokens(store: Store, proxy: ProxyServer): Promise<void> {
  const snap = (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
  const accounts = snap.accounts ?? []
  const now = Date.now()
  const expiring = accounts.filter(a =>
    a.enabled !== false &&
    a.refreshToken &&
    (!a.expiresAt || a.expiresAt < now + REFRESH_AHEAD_MS),
  )
  if (expiring.length === 0) return

  proxyLogger.info('AutoRefresh', `refreshing ${expiring.length} token(s)`)

  const results = await Promise.all(expiring.map(async a => {
    try {
      const r = await refreshTokenByMethod(
        a.refreshToken || '',
        a.clientId || '',
        a.clientSecret || '',
        a.region || 'us-east-1',
        a.authMethod,
        a.proxyUrl,
      )
      return { id: a.id, email: a.email, ok: r.success, r, err: r.error }
    } catch (err) {
      return { id: a.id, email: a.email, ok: false, err: (err as Error).message }
    }
  }))

  // Re-read the snapshot in case the store changed while requests were
  // in-flight (manual refresh button, import, etc.) and apply only the
  // successful refreshes.
  const cur = (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
  const list = cur.accounts ?? []
  let changed = 0
  for (const res of results) {
    if (!res.ok || !res.r?.accessToken) {
      proxyLogger.warn('AutoRefresh', `${res.email || res.id}: ${res.err || 'failed'}`)
      continue
    }
    const idx = list.findIndex(x => x.id === res.id)
    if (idx < 0) continue
    list[idx] = {
      ...list[idx],
      accessToken: res.r.accessToken,
      refreshToken: res.r.refreshToken || list[idx].refreshToken,
      expiresAt: Date.now() + (res.r.expiresIn || 3600) * 1000,
    }
    changed++
    // Push to the live AccountPool so /v1/* requests immediately see the
    // refreshed token without waiting for ProxyServer's own lazy refresh.
    proxy.getAccountPool().updateAccount(res.id, list[idx])
  }
  if (changed > 0) {
    store.set('accountData', { ...cur, accounts: list })
    proxyLogger.info('AutoRefresh', `refreshed ${changed} token(s)`)
  }
}
