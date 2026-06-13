/**
 * Background usage/quota refresher.
 *
 * Subscription credits in the UI come from /api/accounts/:id/query-subscription
 * — but that's only triggered when the user clicks "查询订阅" or imports an
 * account. So a long-running pool will keep showing stale "0% used / 1000
 * credits" while the account silently chews through its real budget.
 *
 * This module mirrors autoRefresh.ts: kicks once at startup (after the token
 * refresher has a chance to settle), then every USAGE_REFRESH_PERIOD_MS, calls
 * the upstream getUsageLimits endpoint for each enabled account, and persists
 * the snapshot back to disk so the UI cards reflect reality.
 */
import type { ProxyServer } from '../proxy/proxyServer.js'
import type { ProxyAccount } from '../proxy/types.js'
import { Store } from './store.js'
import { fetchUsageSnapshot } from './fetchUsage.js'
import { proxyLogger } from '../proxy/logger.js'

// 5 minutes — short enough to feel live, long enough that 6 accounts × 1 call
// each = ~12 calls/hour stays well under any plausible upstream rate limit.
const USAGE_REFRESH_PERIOD_MS = 5 * 60 * 1000
const STARTUP_DELAY_MS = 30 * 1000

interface Snapshot {
  accounts?: ProxyAccount[]
  [k: string]: unknown
}

function pickBetterEmail(existing?: string, fresh?: string): string | undefined {
  if (!fresh) return existing
  if (!existing) return fresh
  // Prefer non-placeholder emails. Imported accounts sometimes have a synthetic
  // address; the upstream returns the real one.
  if (existing.includes('placeholder') || existing.includes('unknown')) return fresh
  return existing
}

export function startUsageAutoRefresh(store: Store, proxy: ProxyServer): NodeJS.Timeout {
  const tick = async () => {
    try {
      await refreshAllUsage(store, proxy)
    } catch (err) {
      proxyLogger.warn('UsageRefresh', `tick failed: ${(err as Error).message}`)
    }
  }
  setTimeout(tick, STARTUP_DELAY_MS)
  return setInterval(tick, USAGE_REFRESH_PERIOD_MS)
}

async function refreshAllUsage(store: Store, proxy: ProxyServer): Promise<void> {
  const snap = (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
  const accounts = snap.accounts ?? []
  const targets = accounts.filter(a => a.enabled !== false && a.accessToken)
  if (targets.length === 0) return

  proxyLogger.info('UsageRefresh', `polling ${targets.length} account(s)`)

  const results = await Promise.all(targets.map(async a => {
    try {
      const r = await fetchUsageSnapshot({
        accessToken: a.accessToken || '',
        profileArn: a.profileArn,
        proxyUrl: a.proxyUrl,
      })
      return { id: a.id, email: a.email, snap: r }
    } catch (err) {
      return { id: a.id, email: a.email, snap: { error: (err as Error).message } }
    }
  }))

  // Re-read the on-disk snapshot in case the store changed while we were
  // waiting on upstream (token auto-refresh, manual UI edit, import).
  const cur = (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
  const list = cur.accounts ?? []
  let updated = 0
  for (const res of results) {
    if ('error' in res.snap) {
      proxyLogger.warn('UsageRefresh', `${res.email || res.id}: ${res.snap.error}`)
      continue
    }
    const idx = list.findIndex(x => x.id === res.id)
    if (idx < 0) continue
    const us = res.snap
    // ProxyAccount's TS type doesn't declare subscription/usage, but the
    // on-disk schema and accounts.ts query-subscription handler both carry
    // them. Build via index-signature record to avoid excess-property errors,
    // matching that handler's pattern (list-map then `as typeof list`).
    const merged: Record<string, unknown> = {
      ...list[idx],
      email: pickBetterEmail(list[idx].email, us.email),
      quotaUsed: us.quotaUsed,
      quotaLimit: us.quotaLimit,
      quotaResetAt: us.quotaResetAt,
      subscription: us.subscription,
      usage: us.usage,
    }
    list[idx] = merged as unknown as ProxyAccount
    updated++
    // Push to the live pool so the next request sees the same numbers the UI
    // does (mostly cosmetic — the pool's selection logic doesn't read these
    // fields today, but keep them in sync to avoid future drift).
    proxy.getAccountPool().updateAccount(res.id, list[idx])
  }
  if (updated > 0) {
    store.set('accountData', { ...cur, accounts: list })
    proxyLogger.info('UsageRefresh', `updated ${updated} account(s)`)
  }
}
