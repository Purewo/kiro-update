import { useState } from 'react'
import { api } from '../api'

export function SettingsView() {
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const change = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwd.length < 6) {
      setErr('密码至少 6 位')
      return
    }
    if (pwd !== pwd2) {
      setErr('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      await api.changePassword(pwd)
      setMsg('密码已修改。')
      setPwd('')
      setPwd2('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>设置</h2>
      <form onSubmit={change} className="card" style={{ maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: '#9ba3b4' }}>修改管理员密码</h3>
        <input className="input" type="password" placeholder="新密码" value={pwd} onChange={e => setPwd(e.target.value)} />
        <input className="input" type="password" placeholder="再次输入新密码" value={pwd2} onChange={e => setPwd2(e.target.value)} style={{ marginTop: 8 }} />
        {err && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{err}</div>}
        {msg && <div style={{ color: '#4ade80', fontSize: 13, marginTop: 8 }}>{msg}</div>}
        <button className="btn" disabled={busy || !pwd} type="submit" style={{ marginTop: 12 }}>修改密码</button>
      </form>

      <div className="card" style={{ maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, fontSize: 14, color: '#9ba3b4' }}>环境变量</h3>
        <p className="muted" style={{ margin: '4px 0' }}>启动服务前可通过下列环境变量覆盖默认配置：</p>
        <pre>PROXY_PORT=29080      # 反代监听端口
ADMIN_PORT=29081      # 管理界面端口
PROXY_HOST=127.0.0.1  # 监听地址
ADMIN_HOST=127.0.0.1
KIRO_DATA_DIR=...     # 数据目录
KIRO_STORE_KEY=...    # 可选 AES-256-GCM 静态加密
ADMIN_PASSWORD=...    # 默认管理员密码（仅在未设置时生效）
HTTPS_PROXY=http://127.0.0.1:17893  # 出站代理</pre>
      </div>
    </div>
  )
}
