/**
 * Proxy control + stats API.
 */
import type { FastifyInstance } from 'fastify'
import type { ProxyServer } from '../proxy/proxyServer.js'
import type { ProxyConfig } from '../proxy/types.js'
import { Store } from '../utils/store.js'
import { requireAuth } from './auth.js'

interface Snapshot {
  proxyConfig?: Partial<ProxyConfig>
  [k: string]: unknown
}

function loadSnapshot(store: Store): Snapshot {
  return (store.get<Snapshot>('accountData', {}) ?? {}) as Snapshot
}

function saveProxyConfig(store: Store, cfg: Partial<ProxyConfig>): void {
  const snap = loadSnapshot(store)
  snap.proxyConfig = { ...(snap.proxyConfig ?? {}), ...cfg }
  store.set('accountData', snap)
}

export async function registerProxyApi(
  fastify: FastifyInstance,
  store: Store,
  proxy: ProxyServer,
): Promise<void> {
  fastify.get('/api/proxy/status', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    return {
      running: proxy.isRunning(),
      config: proxy.getConfig(),
      stats: proxy.getStats(),
      session: proxy.getSessionStats(),
    }
  })

  fastify.post('/api/proxy/start', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    if (proxy.isRunning()) return { ok: true, alreadyRunning: true }
    try {
      await proxy.start()
      return { ok: true }
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  fastify.post('/api/proxy/stop', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    if (!proxy.isRunning()) return { ok: true, alreadyStopped: true }
    try {
      await proxy.stop(2000)
      return { ok: true }
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  fastify.post('/api/proxy/restart', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    try {
      await proxy.restartServer()
      return { ok: true }
    } catch (err) {
      reply.code(500)
      return { error: (err as Error).message }
    }
  })

  fastify.get('/api/proxy/config', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    return proxy.getConfig()
  })

  fastify.put('/api/proxy/config', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const body = (req.body || {}) as Partial<ProxyConfig>
    proxy.updateConfig(body)
    saveProxyConfig(store, body)
    return { ok: true, needsRestart: proxy.needsRestart() }
  })

  // Quick reset of stat counters (UI button).
  fastify.post('/api/proxy/reset-stats', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    proxy.resetTotalCredits()
    proxy.resetTotalTokens()
    proxy.resetRequestStats()
    return { ok: true }
  })
}
