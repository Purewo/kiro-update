import { useEffect, useState } from 'react'
import { api } from '../api'

export function LogsView() {
  const [lines, setLines] = useState<string[]>([])
  const [auto, setAuto] = useState(true)

  const refresh = async () => {
    try {
      const r = await api.tailLog(300)
      setLines(r.lines || [])
    } catch {}
  }

  useEffect(() => {
    refresh()
    if (!auto) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [auto])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>日志</h2>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
          <span className="muted">自动刷新（3 秒）</span>
        </label>
        <button className="btn secondary" onClick={refresh}>刷新</button>
      </div>
      <div className="card" style={{ padding: 12 }}>
        {lines.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>暂无日志，发送一次 /v1/messages 请求即可生成。</p>
        ) : (
          <pre style={{ maxHeight: '70vh', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{lines.join('\n')}</pre>
        )}
      </div>
    </div>
  )
}
