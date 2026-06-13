# Kiro Web

Linux web service version of `kiro-manager-new` (account manager + reverse proxy),
with Electron stripped out and only the reverse-proxy paths kept. Account
registration is intentionally **not** included.

## Layout

```
kiro-web/
├── server/                  # Fastify backend (Node 22+, TypeScript)
│   └── src/
│       ├── proxy/           # Borrowed from Manager src/main/proxy/ (incl.
│       │                    # the enterprise-account profileArn fix)
│       ├── api/             # HTTP routes for the admin UI
│       ├── utils/           # dataDir, JSON-file Store
│       ├── kiroAuthSync.ts  # Stub of the placeholder ARN constants
│       ├── kproxy.ts        # No-op stub for the local MITM service
│       └── index.ts         # Process entry: ProxyServer + Fastify admin
└── web/                     # React SPA admin UI (Vite)
    └── src/
        ├── App.tsx
        ├── api.ts           # fetch helpers for /api/*
        └── components/      # ProxyView, AccountsView, KeysView, LogsView, SettingsView
```

## Two ports, one process

| Port (default) | Role |
|---|---|
| `PROXY_PORT=19080` | Reverse proxy. Clients (Claude Code, Cline, ...) hit `/v1/*` here with a configured API key. |
| `ADMIN_PORT=19081` | Admin UI + JSON API. Cookie-session, single-user password. |

The two listeners share one in-process AccountPool and one persistence file.

## Storage

- `~/.kiro-web/kiro-accounts.json` (override with `KIRO_DATA_DIR`)
- Optional AES-256-GCM at rest by setting `KIRO_STORE_KEY=<anything>`

## Run (dev, two terminals)

```bash
# Terminal 1 — backend
cd kiro-web/server
npm install
npm run dev   # tsx watch src/index.ts

# Terminal 2 — frontend
cd kiro-web/web
npm install
npm run dev   # vite on http://127.0.0.1:5173
```

The Vite dev server proxies `/api/*` to the admin port at 19091, so opening
<http://127.0.0.1:5173> works end-to-end.

## Run (single binary, after build)

```bash
cd kiro-web/web && npm run build
cd ../server   && npm install && npm run start

# admin UI:   http://127.0.0.1:19081
# proxy port: http://127.0.0.1:19080
```

## What was carried over from kiro-manager-new

- The full `src/main/proxy/` subsystem (account pool, kiroApi with the
  enterprise-account `ListAvailableProfiles` fix, translator, prompt-cache
  tracker, token counter, proxy server with retry / failover, self-signed cert
  generator).
- The Fastify admin server is minimal and only wires the routes the new SPA
  uses; everything else is unchanged.

## What was dropped

- `src/main/registration/` (account registration with proton-mail, fingerprint,
  TLS client) — out of scope.
- `src/main/kproxy/` (local MITM proxy that rewrites machineId).
- `src/main/kiroAuthSync.ts` (writes Kiro IDE token files locally).
- Electron tray, dialog, autoUpdater, BrowserWindow OAuth flows, machineId
  rewriting, IDE-settings editor.
- The original Electron renderer (preserved as `web-original-renderer/` for
  reference; not built).
