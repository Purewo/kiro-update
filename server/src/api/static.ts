/**
 * Static UI: serve the built React SPA from `web/dist/` (after `pnpm build`).
 *
 * In dev, the React app is served by Vite on its own port (5173); only after
 * a production build does this route do anything useful. When the dist
 * directory is missing we serve a small placeholder so /health users don't
 * see a 500.
 */
import type { FastifyInstance } from 'fastify'
import staticPlugin from '@fastify/static'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function registerStaticUi(fastify: FastifyInstance): Promise<void> {
  // Tiny no-content favicon so browsers stop firing 500s into the console.
  fastify.get('/favicon.ico', async (_req, reply) => {
    reply.code(204).send()
  })

  // Walk up from src/api/ → server/ → kiro-web/ → web/dist
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'web', 'dist'),
    path.resolve(__dirname, '..', '..', '..', '..', 'web', 'dist'),
    path.resolve(process.cwd(), 'web', 'dist'),
    path.resolve(process.cwd(), '..', 'web', 'dist'),
  ]
  const root = candidates.find(p => fs.existsSync(path.join(p, 'index.html')))
  if (!root) {
    // Placeholder root.
    fastify.get('/', async (_req, reply) => {
      reply.type('text/html')
      return `<!doctype html>
<html><body style="font-family:system-ui;padding:2rem">
<h2>Kiro Web — UI not built</h2>
<p>Run <code>pnpm --dir web build</code> to produce <code>web/dist/</code>.</p>
<p>Admin API is up at <code>/api/*</code>. Reverse proxy listens on the configured proxy port.</p>
</body></html>`
    })
    return
  }
  await fastify.register(staticPlugin, {
    root,
    prefix: '/',
    decorateReply: false,
  })
  // SPA fallback for client-side routing — anything not matched returns index.html.
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' })
      return
    }
    reply.type('text/html').sendFile('index.html', root)
  })
}
