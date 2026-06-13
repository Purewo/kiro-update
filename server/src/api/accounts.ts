/**
 * Accounts API: list/upsert/delete/enable/disable + JSON import.
 *
 * Persistence: all CRUD writes the full snapshot back to the store under the
 * 'accountData' key (mirrors how the Electron Manager stored it). The
 * AccountPool is updated in lockstep so subsequent /v1/* requests see the
 * change immediately, no proxy restart required.
 */
import type { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import type { ProxyServer } from '../proxy/proxyServer.js'
import type { ProxyAccount } from '../proxy/types.js'
import { fetchKiroModels } from '../proxy/kiroApi.js'
import { fetchUsageSnapshot } from '../utils/fetchUsage.js'
import { Store } from '../utils/store.js'
import { refreshTokenByMethod } from '../utils/tokenRefresh.js'
import { requireAuth } from './auth.js'

interface Snapshot {
  accounts?: ProxyAccount[]
  [k: string]: unknown
}

function loadSnapshot(store: Store): Snapshot {
  return (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
}

function saveAccounts(store: Store, accounts: ProxyAccount[]): void {
  const snap = loadSnapshot(store)
  snap.accounts = accounts
  store.set('accountData', snap)
}

function syncPool(proxy: ProxyServer, accounts: ProxyAccount[]): void {
  const pool = proxy.getAccountPool()
  const desired = new Map(accounts.filter(a => a.enabled !== false).map(a => [a.id, a]))
  // Remove accounts no longer enabled or deleted.
  for (const a of pool.getAllAccounts()) {
    if (!desired.has(a.id)) pool.removeAccount(a.id)
  }
  // Add or update remaining.
  for (const [id, a] of desired) {
    if (pool.getAccount(id)) {
      pool.updateAccount(id, a)
    } else {
      pool.addAccount(a)
    }
  }
}

export async function registerAccountsApi(
  fastify: FastifyInstance,
  store: Store,
  proxy: ProxyServer,
): Promise<void> {
  fastify.get('/api/accounts', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const snap = loadSnapshot(store)
    // Strip credentials before handing off to the UI: refreshToken/accessToken
    // are 1-2KB each and the admin page never displays them. Keeping them in
    // the response made every 5s polling tick re-parse ~10KB per account on
    // top of slowing the visible repaint. The UI only uses id/email/usage etc.
    const accounts = (snap.accounts ?? []).map(a => {
      const { accessToken: _at, refreshToken: _rt, clientSecret: _cs, ...safe } = a as ProxyAccount & {
        accessToken?: string
        refreshToken?: string
        clientSecret?: string
      }
      void _at; void _rt; void _cs
      return safe
    })
    return { accounts }
  })

  // Replace whole list (used by bulk save from UI).
  fastify.put('/api/accounts', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = (req.body || {}) as { accounts?: ProxyAccount[] }
    if (!Array.isArray(body.accounts)) {
      reply.code(400)
      return { error: 'accounts must be an array' }
    }
    saveAccounts(store, body.accounts)
    syncPool(proxy, body.accounts)
    return { ok: true, count: body.accounts.length }
  })

  // Add single account.
  fastify.post('/api/accounts', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = (req.body || {}) as Partial<ProxyAccount>
    const snap = loadSnapshot(store)
    const accounts = snap.accounts ?? []
    const acc: ProxyAccount = {
      id: body.id || uuidv4(),
      enabled: body.enabled !== false,
      ...body,
    } as ProxyAccount
    accounts.push(acc)
    saveAccounts(store, accounts)
    syncPool(proxy, accounts)
    return { ok: true, account: acc }
  })

  fastify.put('/api/accounts/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const updates = (req.body || {}) as Partial<ProxyAccount>
    const snap = loadSnapshot(store)
    const accounts = snap.accounts ?? []
    const idx = accounts.findIndex(a => a.id === id)
    if (idx < 0) {
      reply.code(404)
      return { error: 'Account not found' }
    }
    accounts[idx] = { ...accounts[idx], ...updates, id }
    saveAccounts(store, accounts)
    syncPool(proxy, accounts)
    return { ok: true, account: accounts[idx] }
  })

  fastify.delete('/api/accounts/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const snap = loadSnapshot(store)
    const accounts = (snap.accounts ?? []).filter(a => a.id !== id)
    saveAccounts(store, accounts)
    syncPool(proxy, accounts)
    return { ok: true }
  })

  // Bulk import from one OR many JSON files (multipart upload).
  // Each file is parsed independently then concatenated into a single
  // imported[] array so the existing dedup-by-email/token + enrich pipeline
  // applies uniformly. Accepts Manager export, snake_case third-party blobs,
  // raw account objects, and {accounts:[...]} wrappers — mixed in one batch.
  fastify.post('/api/accounts/import', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const texts: string[] = []
    const errors: { name: string; error: string }[] = []
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue
      try {
        const buf = await part.toBuffer()
        texts.push(buf.toString('utf8'))
      } catch (err) {
        errors.push({ name: part.filename || '(unnamed)', error: (err as Error).message })
      }
    }
    if (texts.length === 0) {
      reply.code(400)
      return { error: 'No file uploaded', fileErrors: errors }
    }
    return importJsonTexts(req, reply, texts, errors)
  })

  // Paste-JSON import: same parser, JSON body. The Manager "复制账号" button
  // produces a 4-field credentials blob ({accessToken, refreshToken, clientId,
  // clientSecret}) — this endpoint accepts that, plus any of the multipart
  // formats above, sent as { json: "..." } or as the raw object.
  fastify.post('/api/accounts/import-paste', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = (req.body || {}) as { json?: string } | unknown
    let raw = ''
    if (typeof body === 'object' && body !== null && typeof (body as { json?: unknown }).json === 'string') {
      raw = (body as { json: string }).json
    } else {
      raw = JSON.stringify(body)
    }
    return importJsonText(req, reply, raw)
  })

  // Shared parser used by both /import (file upload) and /import-paste (text body).
  async function importJsonText(_req: unknown, reply: import('fastify').FastifyReply, text: string) {
    return importJsonTexts(_req, reply, [text], [])
  }

  // Multi-text variant: parse each blob, accumulate, then run the same
  // dedup + persist + enrich pipeline once. Per-text parse failures are
  // collected and reported alongside successes — partial batches still go in.
  async function importJsonTexts(
    _req: unknown,
    reply: import('fastify').FastifyReply,
    texts: string[],
    fileErrors: { name: string; error: string }[],
  ) {
    let imported: Partial<ProxyAccount>[] = []
    const parseErrors = [...fileErrors]
    texts.forEach((text, idx) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (err) {
        parseErrors.push({ name: `payload#${idx + 1}`, error: 'Invalid JSON: ' + (err as Error).message })
        return
      }
      if (Array.isArray(parsed)) {
        imported.push(...(parsed as Record<string, unknown>[]).map(normalizeFromExport))
      } else if (parsed && typeof parsed === 'object') {
        const o = parsed as Record<string, unknown>
        if (Array.isArray(o.accounts)) {
          imported.push(...(o.accounts as Record<string, unknown>[]).map(normalizeFromExport))
        } else if (o.credentials || o.accessToken || o.access_token) {
          imported.push(normalizeFromExport(o))
        }
      }
    })

    if (imported.length === 0) {
      reply.code(400)
      return { error: 'No recognizable accounts in JSON', fileErrors: parseErrors }
    }

    const snap = loadSnapshot(store)
    const existing = snap.accounts ?? []
    // Match by email when present, otherwise by accessToken (Manager
    // clipboard format has no email — fall back to token uniqueness so
    // re-pasting the same blob updates instead of duplicating).
    const byEmail = new Map(existing.filter(a => a.email).map(a => [a.email!, a]))
    const byToken = new Map(existing.filter(a => a.accessToken).map(a => [a.accessToken, a]))
    let added = 0, updated = 0
    for (const a of imported) {
      const acc: ProxyAccount = {
        ...a,
        // id/enabled written AFTER the spread so undefined values from the
        // import payload don't clobber a freshly-generated UUID.
        id: a.id || uuidv4(),
        enabled: a.enabled !== false,
      } as ProxyAccount
      const match = (acc.email && byEmail.get(acc.email)) || (acc.accessToken && byToken.get(acc.accessToken))
      if (match) {
        const idx = existing.indexOf(match)
        existing[idx] = { ...match, ...acc, id: match.id }
        updated++
      } else {
        existing.push(acc)
        added++
      }
    }
    saveAccounts(store, existing)
    syncPool(proxy, existing)

    // Best-effort: for newly-imported accounts that arrived without
    // subscription / usage (typical for snake_case third-party blobs that
    // only carry credentials), fetch the live block from Kiro's REST API so
    // the account card has KIRO PRO/POWER+/usage% to render. Failures are
    // logged-and-ignored — the account is still importable, just sparse.
    void enrichWithUsage(store, proxy, imported)

    return { ok: true, added, updated, total: existing.length, fileErrors: parseErrors }
  }

  // Refresh OAuth tokens for one account.
  fastify.post('/api/accounts/:id/refresh', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const snap = loadSnapshot(store)
    const accounts = snap.accounts ?? []
    const acc = accounts.find(a => a.id === id)
    if (!acc) {
      reply.code(404)
      return { error: 'Account not found' }
    }
    const r = await refreshTokenByMethod(
      acc.refreshToken || '',
      acc.clientId || '',
      acc.clientSecret || '',
      acc.region || 'us-east-1',
      acc.authMethod,
      acc.proxyUrl,
    )
    if (!r.success) {
      reply.code(502)
      return { error: r.error || 'refresh failed' }
    }
    if (r.accessToken) acc.accessToken = r.accessToken
    if (r.refreshToken) acc.refreshToken = r.refreshToken
    if (r.expiresIn) acc.expiresAt = Date.now() + r.expiresIn * 1000
    saveAccounts(store, accounts)
    syncPool(proxy, accounts)
    return { ok: true, expiresAt: acc.expiresAt }
  })

  // Query the upstream subscription / quota for an account and persist it back
  // to the snapshot so the UI card refreshes.
  fastify.post('/api/accounts/:id/query-subscription', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const snap = loadSnapshot(store)
    const accounts = snap.accounts ?? []
    const acc = accounts.find(a => a.id === id)
    if (!acc) {
      reply.code(404)
      return { error: 'Account not found' }
    }
    try {
      // 1. Pre-refresh near-expiry token so getUsageLimits doesn't 403.
      const expiringSoon = acc.expiresAt && acc.expiresAt < Date.now() + 60_000
      if (expiringSoon && acc.refreshToken) {
        const tr = await refreshTokenByMethod(
          acc.refreshToken,
          acc.clientId || '',
          acc.clientSecret || '',
          acc.region || 'us-east-1',
          acc.authMethod,
          acc.proxyUrl,
        )
        if (tr.success && tr.accessToken) {
          acc.accessToken = tr.accessToken
          if (tr.refreshToken) acc.refreshToken = tr.refreshToken
          if (tr.expiresIn) acc.expiresAt = Date.now() + tr.expiresIn * 1000
        }
      }

      // 2. Call getUsageLimits and merge real subscription/usage into the
      //    persisted account. Manager's "查询订阅" button does the same — the
      //    cached subscriptionPlans menu is irrelevant here.
      const usageSnap = await fetchUsageSnapshot({
        accessToken: acc.accessToken || '',
        profileArn: acc.profileArn,
        proxyUrl: acc.proxyUrl,
      })
      if ('error' in usageSnap) {
        reply.code(502)
        return { error: usageSnap.error }
      }

      const updated = accounts.map(a => a.id === id ? {
        ...a,
        accessToken: acc.accessToken,
        refreshToken: acc.refreshToken,
        expiresAt: acc.expiresAt,
        subscription: usageSnap.subscription,
        usage: usageSnap.usage,
        email: pickBetterEmail(a.email, usageSnap.email),
        userId: (a as unknown as Record<string, unknown>).userId || usageSnap.userId,
        quotaUsed: usageSnap.quotaUsed,
        quotaLimit: usageSnap.quotaLimit,
        quotaResetAt: usageSnap.quotaResetAt,
      } : a)
      saveAccounts(store, updated as typeof accounts)
      syncPool(proxy, updated as typeof accounts)
      return { ok: true, subscription: usageSnap.subscription, usage: usageSnap.usage }
    } catch (err) {
      reply.code(502)
      return { error: (err as Error).message }
    }
  })

  // Test connectivity by listing models for one account.
  fastify.post('/api/accounts/:id/test', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const snap = loadSnapshot(store)
    const accounts = snap.accounts ?? []
    const acc = accounts.find(a => a.id === id)
    if (!acc) {
      reply.code(404)
      return { error: 'Account not found' }
    }
    try {
      const models = await fetchKiroModels(acc as ProxyAccount)
      return {
        ok: true,
        modelCount: models.length,
        models: models.map(m => m.modelId).slice(0, 20),
      }
    } catch (err) {
      reply.code(502)
      return { error: (err as Error).message }
    }
  })
}

/** Normalize the desktop Manager export schema (which nests credentials.*) into ProxyAccount.
 *  Also tolerates snake_case third-party exports
 *  ({ access_token, refresh_token, client_id, client_secret, auth_method,
 *     profile_arn, expires_at, ... }). */
function normalizeFromExport(src: Record<string, unknown>): Partial<ProxyAccount> {
  const c = (src.credentials || {}) as Record<string, unknown>
  const sub = (src.subscription || {}) as Record<string, unknown>
  const usage = (src.usage || {}) as Record<string, unknown>

  // Lookup with camelCase fallback to snake_case at both src level and the
  // nested credentials block, so the same accessor works across export
  // schemas without per-field branching.
  const get = <T>(camel: string, snake?: string): T => {
    const s = snake ?? camel.replace(/[A-Z]/g, ch => '_' + ch.toLowerCase())
    return (
      src[camel] !== undefined ? src[camel] :
      src[s] !== undefined ? src[s] :
      c[camel] !== undefined ? c[camel] :
      c[s] !== undefined ? c[s] :
      undefined
    ) as T
  }

  // expires_at can be ISO string or epoch ms — convert to ms.
  const rawExpires = get<string | number>('expiresAt', 'expires_at')
  let expiresAt: number | undefined
  if (typeof rawExpires === 'number') {
    expiresAt = rawExpires
  } else if (typeof rawExpires === 'string' && rawExpires) {
    const t = Date.parse(rawExpires)
    expiresAt = isNaN(t) ? undefined : t
  } else if (typeof get<number>('expiresIn', 'expires_in') === 'number') {
    expiresAt = Date.now() + get<number>('expiresIn', 'expires_in') * 1000
  }

  // Auth method inference for the bare-bones Manager-clipboard schema, which
  // omits authMethod entirely:
  //   { accessToken, refreshToken, clientId, clientSecret }
  // Heuristic: a non-empty clientId+clientSecret pair → IdC/Enterprise OIDC;
  // otherwise (BuilderId / GitHub / Google) → social. The proxy layer handles
  // both flavors based on this field, so getting it right at import time
  // avoids "no token refresh callback configured" errors later.
  let authMethod = get<ProxyAccount['authMethod']>('authMethod', 'auth_method')
  if (!authMethod) {
    const cid = get<string>('clientId', 'client_id') || ''
    const csec = get<string>('clientSecret', 'client_secret') || ''
    authMethod = (cid && csec) ? 'idc' : 'social'
  }

  const out: Partial<ProxyAccount> & Record<string, unknown> = {
    id: src.id as string | undefined,
    email: src.email as string | undefined,
    userId: (src.userId || src.user_id) as string | undefined,
    nickname: src.nickname as string | undefined,
    enabled: src.enabled !== false,
    accessToken: get<string>('accessToken', 'access_token'),
    refreshToken: get<string>('refreshToken', 'refresh_token'),
    clientId: get<string>('clientId', 'client_id'),
    clientSecret: get<string>('clientSecret', 'client_secret'),
    authMethod,
    provider: get<string>('provider') || (src.idp as string),
    region: get<string>('region') || 'us-east-1',
    expiresAt,
    machineId: (src.machineId || src.machine_id) as string | undefined,
    profileArn: get<string>('profileArn', 'profile_arn'),
    // Quota tracking, sourced from `usage` block in the export.
    quotaUsed: typeof usage.current === 'number' ? (usage.current as number) : undefined,
    quotaLimit: typeof usage.limit === 'number' ? (usage.limit as number) : undefined,
    // Reset timestamp: backend stores as number; export sometimes gives ISO.
    quotaResetAt: typeof usage.nextResetDate === 'string'
      ? Date.parse(usage.nextResetDate as string)
      : (usage.nextResetDate as number | undefined),
    // Display-only extras the UI surfaces but the proxy doesn't need typed.
    idp: src.idp as string | undefined,
    subscription: src.subscription as Record<string, unknown> | undefined,
    usage: src.usage as Record<string, unknown> | undefined,
    status: src.status as string | undefined,
    createdAt: src.createdAt as number | undefined,
    lastUsedAt: (src.lastUsedAt as number | undefined),
  }
  void sub
  return out as Partial<ProxyAccount>
}

/**
 * Background helper. For each freshly-imported account that lacks a
 * subscription/usage block, hit Kiro's REST API and patch the snapshot in
 * place. Errors are swallowed — the account remains importable and shows
 * blank quota until the user clicks the "查询订阅" button manually.
 */
async function enrichWithUsage(
  store: Store,
  proxy: ProxyServer,
  imported: Partial<ProxyAccount>[],
): Promise<void> {
  await Promise.all(imported.map(async a => {
    if (!a.accessToken) return
    const hasSub = !!(a as Record<string, unknown>).subscription &&
      Object.keys(((a as Record<string, unknown>).subscription as Record<string, unknown>) || {}).length > 0
    const hasUsage = !!(a as Record<string, unknown>).usage &&
      Object.keys(((a as Record<string, unknown>).usage as Record<string, unknown>) || {}).length > 0
    if (hasSub && hasUsage) return

    // The imported access token may already be expired (third-party
    // exporters often dump credentials hours after generation). Refresh
    // first so the upstream getUsageLimits call doesn't 403 immediately.
    let accessToken = a.accessToken
    const expired = a.expiresAt && a.expiresAt < Date.now() + 60_000
    if (expired && a.refreshToken) {
      try {
        const r = await refreshTokenByMethod(
          a.refreshToken || '',
          a.clientId || '',
          a.clientSecret || '',
          a.region || 'us-east-1',
          a.authMethod,
          a.proxyUrl,
        )
        if (r.success && r.accessToken) {
          accessToken = r.accessToken
          // Persist refreshed token immediately so the enrich step uses fresh
          // credentials and the user doesn't see "Token 已过期" right after import.
          const cur = loadSnapshot(store)
          const list = cur.accounts ?? []
          const idx = list.findIndex(x => x.accessToken === a.accessToken || (a.id && x.id === a.id))
          if (idx >= 0) {
            list[idx] = {
              ...list[idx],
              accessToken: r.accessToken,
              refreshToken: r.refreshToken || list[idx].refreshToken,
              expiresAt: Date.now() + (r.expiresIn || 3600) * 1000,
            }
            saveAccounts(store, list)
            syncPool(proxy, list)
          }
        } else {
          console.warn('[enrichWithUsage] pre-refresh failed for', a.email || a.id, ':', r.error)
        }
      } catch (err) {
        console.warn('[enrichWithUsage] pre-refresh threw:', (err as Error).message)
      }
    }

    try {
      const snap = await fetchUsageSnapshot({
        accessToken,
        profileArn: a.profileArn,
        proxyUrl: a.proxyUrl,
      })
      if ('error' in snap) {
        console.warn('[enrichWithUsage]', a.email || a.id, 'failed:', snap.error)
        return
      }
      // Persist back: locate the account by accessToken or id (id may have
      // been generated server-side after we passed `imported` here).
      const cur = loadSnapshot(store)
      const list = cur.accounts ?? []
      const idx = list.findIndex(x =>
        (a.id && x.id === a.id) ||
        (x.accessToken === accessToken) ||
        (a.accessToken && x.accessToken === a.accessToken),
      )
      if (idx < 0) return
      list[idx] = {
        ...list[idx],
        subscription: snap.subscription,
        usage: snap.usage,
        // Replace the email when the imported value is missing OR doesn't
        // look like a real address (no '@'). Manager does the same: the
        // user pastes 4 fields, and Manager backfills the canonical email
        // from upstream userInfo. snap.email wins only if it has '@'.
        email: pickBetterEmail(list[idx].email, snap.email),
        userId: (list[idx] as unknown as Record<string, unknown>).userId || snap.userId,
        quotaUsed: snap.quotaUsed,
        quotaLimit: snap.quotaLimit,
        quotaResetAt: snap.quotaResetAt,
      } as typeof list[number]
      saveAccounts(store, list)
      syncPool(proxy, list)
    } catch (err) {
      console.warn('[enrichWithUsage]', a.email || a.id, 'threw:', (err as Error).message)
    }
  }))
}

/**
 * Choose the better of two email candidates. A "real" address must contain
 * '@'; everything else (e.g. "mrdev28470" pasted by the user as the email
 * field of a snake_case dump) is treated as a placeholder and is overridden
 * by upstream's userInfo.email when one is available.
 */
function pickBetterEmail(local?: string, fromUpstream?: string): string | undefined {
  const looksLikeEmail = (s?: string) => !!s && s.includes('@')
  if (looksLikeEmail(fromUpstream)) {
    if (!looksLikeEmail(local)) return fromUpstream
  }
  return local || fromUpstream
}
