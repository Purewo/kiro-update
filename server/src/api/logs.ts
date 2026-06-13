/**
 * Logs API: tail the proxy log file (best-effort).
 */
import type { FastifyInstance } from 'fastify'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getDataDir } from '../utils/dataDir.js'
import { requireAuth } from './auth.js'

export async function registerLogsApi(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/logs/tail', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    const { lines = 200 } = req.query as { lines?: number }
    const logDir = path.join(getDataDir(), 'logs', 'proxy')
    try {
      const files = fs.readdirSync(logDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ f, t: fs.statSync(path.join(logDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
      if (files.length === 0) return { lines: [] }
      const latest = path.join(logDir, files[0].f)
      const content = fs.readFileSync(latest, 'utf8')
      const all = content.split('\n')
      return { lines: all.slice(-Number(lines)).filter(Boolean) }
    } catch (err) {
      return { lines: [], note: 'logs not yet available' }
    }
  })
}
