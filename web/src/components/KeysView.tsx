import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ApiKey } from '../api'

export function KeysView() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  const refresh = async () => {
    try {
      const r = await api.listKeys()
      setKeys(r.keys || [])
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => { refresh() }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.createKey(name.trim())
      setName('')
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (k: ApiKey) => {
    if (!confirm(`确认删除 Key "${k.name}"？`)) return
    setBusy(true)
    try {
      await api.deleteKey(k.id)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = async (k: ApiKey) => {
    setBusy(true)
    try {
      await api.updateKey(k.id, { enabled: !k.enabled })
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const masked = (k: string) => k.slice(0, 7) + '…' + k.slice(-4)
  const copy = (s: string) => navigator.clipboard.writeText(s)

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>API Key</h2>
      {err && <div className="card" style={{ borderColor: '#7f1d1d', color: '#fca5a5' }}>{err}</div>}

      <form onSubmit={create} className="card" style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="Key 名称（如 claude-code）" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn" disabled={busy || !name.trim()} type="submit">创建 Key</button>
      </form>

      {keys.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>暂无 API Key，请在上方创建。</p></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Key</th>
                <th>状态</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{reveal[k.id] ? k.key : masked(k.key)}</code>
                    <button className="btn secondary" style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }} onClick={() => setReveal(r => ({ ...r, [k.id]: !r[k.id] }))}>
                      {reveal[k.id] ? '隐藏' : '显示'}
                    </button>
                    <button className="btn secondary" style={{ marginLeft: 4, padding: '2px 6px', fontSize: 11 }} onClick={() => copy(k.key)}>复制</button>
                  </td>
                  <td>
                    <span className={`badge ${k.enabled ? 'green' : 'gray'}`}>{k.enabled ? '已启用' : '已禁用'}</span>
                  </td>
                  <td className="muted">{new Date(k.createdAt).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn secondary" disabled={busy} onClick={() => toggleEnabled(k)} style={{ marginRight: 6 }}>
                      {k.enabled ? '禁用' : '启用'}
                    </button>
                    <button className="btn danger" disabled={busy} onClick={() => remove(k)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
