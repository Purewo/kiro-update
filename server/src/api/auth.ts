/**
 * Admin auth: single-user password login → signed cookie session.
 *
 * Web exposes management APIs that the desktop Electron app didn't have to
 * worry about, so we gate everything under /api/* behind a simple cookie auth.
 *
 * Reverse proxy traffic (/v1/*) is unaffected — it lives on the ProxyServer
 * port and uses API keys, not admin cookies.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import * as crypto from 'node:crypto'
import { Store } from '../utils/store.js'

const COOKIE_NAME = 'kiro_web_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SESSION_STORE_KEY = 'authSessions'

interface SessionEntry { expiresAt: number }
type SessionMap = Record<string, SessionEntry>

// Sessions live on disk (encrypted store) so a process restart doesn't kick
// every user back to the login page. Map is the in-memory hot path; load it
// once at module init, save() flushes back. Expired entries are pruned on
// every read so the file doesn't grow forever.
let sessions: SessionMap | null = null
let backingStore: Store | null = null

function load(store: Store): SessionMap {
  if (!sessions || backingStore !== store) {
    backingStore = store
    sessions = (store.get<SessionMap>(SESSION_STORE_KEY, {}) ?? {}) as SessionMap
  }
  return sessions
}

function save(): void {
  if (sessions && backingStore) backingStore.set(SESSION_STORE_KEY, sessions)
}

function pruneExpired(map: SessionMap): boolean {
  const now = Date.now()
  let changed = false
  for (const [tok, sess] of Object.entries(map)) {
    if (sess.expiresAt < now) {
      delete map[tok]
      changed = true
    }
  }
  return changed
}

function newToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function getAdminPassword(store: Store): string {
  const data = store.get<{ adminPassword?: string }>('accountData', {}) ?? {}
  // First-run convenience: if no password set, allow env override or "changeme".
  return data.adminPassword || process.env.ADMIN_PASSWORD || 'changeme'
}

export function isAuthenticated(req: FastifyRequest, store?: Store): boolean {
  const tok = req.cookies?.[COOKIE_NAME]
  if (!tok) return false
  const map = backingStore || store ? load((store || backingStore)!) : null
  if (!map) return false
  const sess = map[tok]
  if (!sess) return false
  if (sess.expiresAt < Date.now()) {
    delete map[tok]
    save()
    return false
  }
  return true
}

export async function registerAuthApi(fastify: FastifyInstance, store: Store): Promise<void> {
  load(store) // warm cache + bind store reference

  fastify.post('/api/auth/login', async (req, reply) => {
    const body = (req.body || {}) as { password?: string }
    const expected = getAdminPassword(store)
    if (!body.password || body.password !== expected) {
      reply.code(401)
      return { error: 'Invalid password' }
    }
    const tok = newToken()
    const map = load(store)
    if (pruneExpired(map)) save() // opportunistic cleanup
    map[tok] = { expiresAt: Date.now() + SESSION_TTL_MS }
    save()
    reply.setCookie(COOKIE_NAME, tok, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      // secure: true in production behind HTTPS — leave it to operator
    })
    return { ok: true }
  })

  fastify.post('/api/auth/logout', async (req, reply) => {
    const tok = req.cookies?.[COOKIE_NAME]
    if (tok) {
      const map = load(store)
      delete map[tok]
      save()
    }
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  fastify.get('/api/auth/me', async (req, reply) => {
    if (!isAuthenticated(req, store)) {
      reply.code(401)
      return { authenticated: false }
    }
    return { authenticated: true }
  })

  fastify.post('/api/auth/change-password', async (req, reply) => {
    if (!isAuthenticated(req, store)) {
      reply.code(401)
      return { error: 'Unauthorized' }
    }
    const body = (req.body || {}) as { newPassword?: string }
    if (!body.newPassword || body.newPassword.length < 6) {
      reply.code(400)
      return { error: 'Password must be at least 6 characters' }
    }
    const data = (store.get<Record<string, unknown>>('accountData', {}) ?? {}) as Record<string, unknown>
    data.adminPassword = body.newPassword
    store.set('accountData', data)
    return { ok: true }
  })
}

/** Helper used by other route modules to require auth. */
export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!isAuthenticated(req)) {
    reply.code(401).send({ error: 'Unauthorized' })
    return false
  }
  return true
}
