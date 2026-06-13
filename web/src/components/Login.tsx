import { useState } from 'react'
import { api } from '../api'

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api.login(pwd)
      onAuthed()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form onSubmit={submit} className="card" style={{ width: 360, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="app-brand" style={{ width: 44, height: 44, marginBottom: 0, fontSize: 18 }}>K</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.01em' }}>Kiro Web</div>
            <div className="dim" style={{ fontSize: 12 }}>管理面板登录</div>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          className="input"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          placeholder="管理员密码"
        />
        {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
        <button type="submit" className="btn" disabled={busy || !pwd} style={{ width: '100%', marginTop: 14, justifyContent: 'center' }}>
          {busy ? '登录中…' : '登录'}
        </button>
        <div className="dim" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
          默认密码 <code>changeme</code>。可通过环境变量 <code>ADMIN_PASSWORD</code> 修改，或登录后在「设置」页修改。
        </div>
      </form>
    </div>
  )
}
