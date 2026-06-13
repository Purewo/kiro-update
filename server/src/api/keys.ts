/**
 * API Key management.
 *
 * API keys gate access to the reverse proxy (/v1/*) on the ProxyServer port.
 * They are stored alongside accounts in the same snapshot and pushed into
 * ProxyConfig.apiKeys so the running ProxyServer authenticates against them.
 */
import type { FastifyInstance } from 'fastify'
import * as crypto from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { ProxyServer } from '../proxy/proxyServer.js'
import type { ApiKey } from '../proxy/types.js'
import { Store } from '../utils/store.js'
import { requireAuth } from './auth.js'

interface Snapshot {
  apiKeys?: ApiKey[]
  [k: string]: unknown
}

function loadSnapshot(store: Store): Snapshot {
  return (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
}

function saveKeys(store: Store, keys: ApiKey[]): void {
  const snap = loadSnapshot(store)
  snap.apiKeys = keys
  store.set('accountData', snap)
}

function pushToProxy(proxy: ProxyServer, keys: ApiKey[]): void {
  proxy.updateConfig({ apiKeys: keys })
}

function generateKey(): string {
  // sk- prefix matches the convention everyone expects from OpenAI-style keys.
  return 'sk-' + crypto.randomBytes(32).toString('hex')
}

export async function registerKeysApi(
  fastify: FastifyInstance,
  store: Store,
  proxy: ProxyServer,
): Promise<void> {
  fastify.get('/api/keys', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const snap = loadSnapshot(store)
    return { keys: snap.apiKeys ?? [] }
  })

  fastify.post('/api/keys', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = (req.body || {}) as Partial<ApiKey>
    const snap = loadSnapshot(store)
    const keys = snap.apiKeys ?? []
    const key: ApiKey = {
      id: uuidv4(),
      name: body.name || 'unnamed',
      key: body.key || generateKey(),
      enabled: body.enabled !== false,
      createdAt: Date.now(),
      // ProxyServer.recordApiKeyUsage assumes apiKey.usage exists; initialize
      // an empty counter struct so the first request doesn't crash with
      // "Cannot read properties of undefined (reading 'totalRequests')".
      usage: {
        totalRequests: 0,
        totalCredits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        daily: {},
      },
      ...body,
    } as ApiKey
    keys.push(key)
    saveKeys(store, keys)
    pushToProxy(proxy, keys)
    return { ok: true, key }
  })

  fastify.put('/api/keys/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const updates = (req.body || {}) as Partial<ApiKey>
    const snap = loadSnapshot(store)
    const keys = snap.apiKeys ?? []
    const idx = keys.findIndex(k => k.id === id)
    if (idx < 0) {
      reply.code(404)
      return { error: 'Key not found' }
    }
    keys[idx] = { ...keys[idx], ...updates, id }
    saveKeys(store, keys)
    pushToProxy(proxy, keys)
    return { ok: true, key: keys[idx] }
  })

  fastify.delete('/api/keys/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { id } = req.params as { id: string }
    const snap = loadSnapshot(store)
    const keys = (snap.apiKeys ?? []).filter(k => k.id !== id)
    saveKeys(store, keys)
    pushToProxy(proxy, keys)
    return { ok: true }
  })
}
