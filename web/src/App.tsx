import { useEffect, useState } from 'react'
import { api } from './api'
import type { Account, ApiKey, ProxyStatus } from './api'
import { Login } from './components/Login'
import { ProxyView } from './components/ProxyView'
import { AccountsView } from './components/AccountsView'
import { KeysView } from './components/KeysView'
import { LogsView } from './components/LogsView'
import { SettingsView } from './components/SettingsView'

type Page = 'proxy' | 'accounts' | 'keys' | 'logs' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('proxy')
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    api.whoami().then(d => setAuthed(d.authenticated)).catch(() => setAuthed(false))
  }, [])

  // The server keeps sessions in-memory, so a process restart invalidates
  // every cookie. api.ts dispatches `kiro-web:unauthorized` on 401 from any
  // /api/* (auth routes excluded); flip back to the login page when it fires
  // so the user sees the prompt instead of an empty list.
  useEffect(() => {
    const handler = () => setAuthed(false)
    window.addEventListener('kiro-web:unauthorized', handler)
    return () => window.removeEventListener('kiro-web:unauthorized', handler)
  }, [])

  if (authed === null) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>加载中...</div>
  }
  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />
  }

  const NAV: { id: Page; icon: string; label: string }[] = [
    { id: 'proxy', icon: '◈', label: '反代' },
    { id: 'accounts', icon: '⚇', label: '账号' },
    { id: 'keys', icon: '⚿', label: '密钥' },
    { id: 'logs', icon: '≡', label: '日志' },
    { id: 'settings', icon: '⚙', label: '设置' },
  ]

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand" title="Kiro Web">K</div>
        {NAV.map(n => (
          <button
            key={n.id}
            className={`nav-item ${page === n.id ? 'active' : ''}`}
            onClick={() => setPage(n.id)}
            title={n.label}
          >
            <span className="nav-icon">{n.icon}</span>
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="nav-item"
          onClick={async () => { await api.logout(); setAuthed(false) }}
          title="退出"
        >
          <span className="nav-icon">⏻</span>
          <span className="nav-label">退出</span>
        </button>
      </aside>
      <main className="app-main">
        {/* Mount each view once and toggle via display:none so cross-tab nav
            doesn't re-fetch /api/proxy/status (~20KB over a 130ms RTT to JP =
            half-second-plus blank "加载中…"). State and pollers stay alive in
            the background; switching back is instant. */}
        <div style={{ display: page === 'proxy' ? 'block' : 'none' }}><ProxyView /></div>
        <div style={{ display: page === 'accounts' ? 'block' : 'none' }}><AccountsView /></div>
        <div style={{ display: page === 'keys' ? 'block' : 'none' }}><KeysView /></div>
        <div style={{ display: page === 'logs' ? 'block' : 'none' }}><LogsView /></div>
        <div style={{ display: page === 'settings' ? 'block' : 'none' }}><SettingsView /></div>
      </main>
    </div>
  )
}

export default App
export type { Account, ApiKey, ProxyStatus }
