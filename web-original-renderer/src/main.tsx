import './api-client' // attach window.api before React mounts
import './styles/globals.css'

import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: pwd }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      onAuthed()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', background: '#0b0d12', color: '#eee' }}>
      <form onSubmit={submit} style={{ background: '#161922', padding: 32, borderRadius: 12, width: 320, boxShadow: '0 4px 32px rgba(0,0,0,.4)' }}>
        <h2 style={{ marginTop: 0 }}>Kiro Web</h2>
        <p style={{ opacity: 0.6, fontSize: 14 }}>Enter the admin password to continue.</p>
        <input
          type="password"
          autoFocus
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          placeholder="admin password"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#0f1218', color: '#eee', fontSize: 15 }}
        />
        {err && <div style={{ color: '#ff7b7b', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <button
          type="submit"
          disabled={busy || !pwd}
          style={{ width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 8, border: 0, background: '#3b82f6', color: 'white', fontSize: 15, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
        >{busy ? 'Signing in...' : 'Sign in'}</button>
        <div style={{ opacity: 0.4, fontSize: 12, marginTop: 12 }}>
          Default password: <code>changeme</code>. Set <code>ADMIN_PASSWORD</code> env or change in Settings.
        </div>
      </form>
    </div>
  )
}

function Boot() {
  const [state, setState] = useState<'checking' | 'login' | 'authed'>('checking')
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { authenticated?: boolean }) => setState(d.authenticated ? 'authed' : 'login'))
      .catch(() => setState('login'))
  }, [])
  if (state === 'checking') return null
  if (state === 'login') return <LoginGate onAuthed={() => setState('authed')} />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>
)
