import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { ProxyStatus, Account, RecentRequest } from '../api'

export function ProxyView() {
  const [status, setStatus] = useState<ProxyStatus | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const refresh = async () => {
    try {
      const s = await api.proxyStatus()
      setStatus(s)
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  // Account list barely changes during a session — fetch once on mount, then
  // again only when the user takes an action that could mutate it (start/stop
  // doesn't, but reset-stats / disable / etc. flow through other views). The
  // old code re-fetched it every 5s alongside status, which doubled JSON
  // parsing cost and made the cumulative-stats page noticeably janky on slow
  // links because each account row carries the full access/refresh tokens.
  const refreshAccounts = async () => {
    try {
      const a = await api.listAccounts()
      setAccounts(a.accounts || [])
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
    refreshAccounts()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])

  const action = async (op: 'start' | 'stop' | 'restart' | 'reset-stats') => {
    setBusy(true)
    setErr('')
    try {
      if (op === 'start') await api.proxyStart()
      else if (op === 'stop') await api.proxyStop()
      else if (op === 'restart') await api.proxyRestart()
      else if (op === 'reset-stats') await api.resetStats()
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const accountEmail = (id: string) => {
    const a = accounts.find(x => x.id === id)
    return a?.email || a?.nickname || id.slice(0, 8) + '…'
  }

  const m = useMemo(() => {
    if (!status) return null
    const s = status.stats
    const sess = status.session
    const totalReq = s.totalRequests || 0
    const okReq = s.successRequests || 0
    const failReq = s.failedRequests || 0
    const enabledAccounts = accounts.filter(a => a.enabled !== false).length
    const successRate = totalReq > 0 ? (okReq / totalReq) * 100 : 0
    const switches = s.totalAccountSwitches || 0
    // Retry rate = average switches per request, rendered as a percent.
    // 0% = no request needed a retry; 100% = every request switched once.
    const retryRate = totalReq > 0 ? (switches / totalReq) * 100 : 0
    const retriedReq = s.retriedRequests || 0
    const totalIn = s.inputTokens || 0
    // Kiro upstream doesn't expose prompt cache stats — its stream only emits
    // contextUsageEvent + meteringEvent (credits). The proxy used to surface
    // simulated cache numbers from promptCacheTracker, but those are
    // fabricated for Claude-API compatibility, not real billed tokens. The
    // dashboard now hides cache stats entirely so what you see is what Kiro
    // actually billed.
    // 24h rolling aggregate. The server prunes the array to the last 24h on
    // every read, so we trust it as-is — no client-side filtering needed.
    const u24 = s.usage24h || []
    let in24 = 0, out24 = 0, credits24 = 0
    for (const e of u24) {
      in24 += e.inputTokens || 0
      out24 += e.outputTokens || 0
      credits24 += e.credits || 0
    }
    return {
      enabledAccounts,
      poolSize: accounts.length,
      totalReq,
      okReq,
      failReq,
      sessReq: sess.totalRequests,
      sessOk: sess.successRequests,
      sessFail: sess.failedRequests,
      uptimeMs: s.startTime ? Date.now() - s.startTime : 0,
      totalTokens: s.totalTokens || 0,
      inputTokens: totalIn,
      outputTokens: s.outputTokens || 0,
      reasoningTokens: s.reasoningTokens || 0,
      successRate,
      credits: s.totalCredits || 0,
      retryRate,
      retriedReq,
      switches,
      recent: s.recentRequests || [],
      // 24h rolling
      req24h: u24.length,
      in24h: in24,
      out24h: out24,
      credits24h: credits24,
    }
  }, [status, accounts])

  if (!status || !m) return <div className="muted">加载中...</div>

  // Retry-rate threshold for the colored chip on the dedicated card.
  // <2% green / 2-5% amber / >5% red — see card label below for trigger.
  const retryTone = m.retryRate < 2 ? 'green' : m.retryRate < 5 ? 'amber' : 'rose'
  const succTone = m.successRate >= 99 ? 'green' : m.successRate >= 95 ? 'amber' : 'rose'

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 className="h-page">反向代理</h1>
        <div className="dim">
          多账号轮询 · 自动 token 刷新 · 实时压测面板
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#fca5a5' }}>{err}</div>
      )}

      {/* Service status + control bar */}
      <div className="card">
        <div className="toolbar">
          <span className={`badge ${status.running ? 'green' : 'gray'}`}>
            {status.running ? '运行中' : '已停止'}
          </span>
          <code style={{ color: 'var(--fg-muted)' }}>
            {status.config.host}:{status.config.port}
          </code>
          <span className="dim">·</span>
          <span className="dim">多账号 {status.config.enableMultiAccount ? '已开启' : '关闭'}</span>
          <div className="grow" />
          {status.running ? (
            <>
              <button className="btn secondary" disabled={busy} onClick={() => action('restart')}>重启</button>
              <button className="btn danger" disabled={busy} onClick={() => action('stop')}>停止</button>
            </>
          ) : (
            <button className="btn" disabled={busy} onClick={() => action('start')}>启动</button>
          )}
          <button className="btn ghost" disabled={busy} onClick={() => action('reset-stats')}>重置统计</button>
        </div>
      </div>

      {/* 24h rolling section — separate band so it's instantly findable */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '24px 4px 10px' }}>
        <h2 className="h-section">最近 24 小时</h2>
        <span className="dim">滚动窗口 · {m.req24h.toLocaleString()} 个成功请求</span>
      </div>
      <div className="grid-stats">
        <Stat tone="violet" icon="↧" label="24h 输入 Tokens" value={fmtBig(m.in24h)} />
        <Stat tone="rose" icon="↥" label="24h 输出 Tokens" value={fmtBig(m.out24h)} />
        <Stat tone="cyan" icon="∑" label="24h 总 Tokens" value={fmtBig(m.in24h + m.out24h)} />
        <Stat tone="amber" icon="◈" label="24h Credits" value={m.credits24h.toFixed(4)} />
      </div>

      {/* Cumulative panel */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '24px 4px 10px' }}>
        <h2 className="h-section">累计概览</h2>
        <span className="dim">服务启动 {fmtDuration(m.uptimeMs)}</span>
      </div>
      <div className="grid-stats">
        <Stat tone="violet" icon="◉" label="账号池" value={`${m.enabledAccounts}/${m.poolSize}`} sub="已启用 / 总数" />
        <Stat tone="blue" icon="↻" label="总请求" value={m.totalReq.toLocaleString()} />
        <Stat
          tone="green"
          icon="✓"
          label="成功 / 失败"
          valueNode={
            <span>
              <span style={{ color: 'var(--success)' }}>{m.okReq.toLocaleString()}</span>
              <span style={{ color: 'var(--fg-subtle)', margin: '0 6px' }}>/</span>
              <span style={{ color: 'var(--danger)' }}>{m.failReq.toLocaleString()}</span>
            </span>
          }
        />
        <Stat tone={succTone} icon="✦" label="成功率" value={`${m.successRate.toFixed(1)}%`} />
        <Stat tone="cyan" icon="◇" label="本次会话" value={m.sessReq.toLocaleString()} sub={`成功 ${m.sessOk} · 失败 ${m.sessFail}`} />
        <Stat tone="amber" icon="∑" label="总 Tokens" value={fmtBig(m.totalTokens)} />
        <Stat
          tone="blue"
          icon="↔"
          label="输入 / 输出"
          valueNode={
            <span>
              <span style={{ color: '#93c5fd' }}>{fmtBig(m.inputTokens)}</span>
              <span style={{ color: 'var(--fg-subtle)', margin: '0 6px' }}>/</span>
              <span style={{ color: '#fda4af' }}>{fmtBig(m.outputTokens)}</span>
            </span>
          }
        />
        <Stat tone="rose" icon="🧠" label="推理 Tokens" value={fmtBig(m.reasoningTokens)} />
        <Stat tone="amber" icon="◈" label="Credits" value={m.credits.toFixed(4)} />
        <Stat
          tone={retryTone}
          icon="↻"
          label={m.retryRate < 2 ? '重试率 · 健康' : m.retryRate < 5 ? '重试率 · 关注' : '重试率 · 建议加号'}
          value={`${m.retryRate.toFixed(2)}%`}
          sub={m.retriedReq > 0 ? `${m.retriedReq} 次切号成功 · 共 ${m.switches} 次切换` : '0 次切号'}
        />
      </div>

      {/* Recent requests */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '24px 4px 10px' }}>
        <h2 className="h-section">最近请求</h2>
        <span className="dim">{m.recent.length} 条 · 倒序</span>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {m.recent.length === 0 ? (
          <div className="muted" style={{ padding: 20, fontSize: 13 }}>
            暂无请求记录。把客户端指向 <code>{status.config.host}:{status.config.port}</code> 后开始用就会出现在这里。
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>路径</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th style={{ textAlign: 'right' }}>切号</th>
                  <th style={{ textAlign: 'right' }}>入</th>
                  <th style={{ textAlign: 'right' }}>出</th>
                  <th style={{ textAlign: 'right' }}>Credits</th>
                  <th style={{ textAlign: 'right' }}>耗时</th>
                  <th>账号</th>
                </tr>
              </thead>
              <tbody>
                {[...m.recent].reverse().slice(0, 100).map((r, i) => <Row key={i} r={r} accountEmail={accountEmail} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* API endpoints */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="h-section" style={{ marginBottom: 8 }}>API 端点</h3>
        <p className="muted" style={{ margin: '0 0 12px' }}>客户端（Claude Code、Cline 等）配置 Base URL + 你的 API Key。</p>
        <pre>{`POST http://${status.config.host}:${status.config.port}/v1/messages
POST http://${status.config.host}:${status.config.port}/v1/chat/completions
GET  http://${status.config.host}:${status.config.port}/v1/models
Authorization: Bearer <你的 API Key>`}</pre>
      </div>
    </div>
  )
}

type StatTone = 'violet' | 'blue' | 'green' | 'amber' | 'rose' | 'cyan' | 'gray'

function Stat({ tone = 'violet', icon, label, value, valueNode, sub }: {
  tone?: StatTone
  icon?: string
  label: string
  value?: string
  valueNode?: React.ReactNode
  sub?: string
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-row">
        <div className={`stat-icon ${tone}`}>{icon || '·'}</div>
        <div className="stat-label">{label}</div>
      </div>
      <div className="stat-value">{valueNode ?? value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function Row({ r, accountEmail }: { r: RecentRequest; accountEmail: (id: string) => string }) {
  const ts = new Date(r.timestamp)
  const tsStr = `${ts.getFullYear()}-${pad2(ts.getMonth() + 1)}-${pad2(ts.getDate())} ${pad2(ts.getHours())}:${pad2(ts.getMinutes())}:${pad2(ts.getSeconds())}`
  // Real upstream status if known; otherwise "ERR" so we don't lie with "5xx".
  const statusText = r.statusCode ? String(r.statusCode) : (r.success ? '200' : 'ERR')
  // 200=green, 4xx=amber, 5xx/ERR=red. 429 (throttle) and 402 (quota) sit
  // in the amber band so the user can tell them apart from real failures.
  let statusColor = '#ef4444'
  if (r.success || r.statusCode === 200) statusColor = '#4ade80'
  else if (r.statusCode && r.statusCode >= 400 && r.statusCode < 500) statusColor = '#f59e0b'
  // attempts = 1 → 0 switches; attempts = N → N-1 switches.
  const attempts = r.attempts || 1
  const switches = attempts - 1
  const chain = (r.accountChain || []).map(id => accountEmail(id).split('@')[0])
  const switchTitle = chain.length ? chain.join(' → ') : '本次请求未切号'
  // Color the switch cell so the eye catches retries: 0 dim, 1 amber, 2+ red.
  const switchColor = switches === 0 ? '#6b7280' : switches === 1 ? '#f59e0b' : '#ef4444'
  return (
    <tr style={{ color: '#cbd1de' }}>
      <td style={tdStyle}>{tsStr}</td>
      <td style={tdStyle}><code style={{ fontSize: 11, color: '#9ba3b4' }}>{r.path}</code></td>
      <td style={tdStyle}>{r.model}</td>
      <td style={{ ...tdStyle, color: statusColor, fontWeight: 600 }}>{statusText}</td>
      <td style={{ ...tdStyle, textAlign: 'right', color: switchColor, fontWeight: switches > 0 ? 600 : 400 }} title={switchTitle}>
        {switches}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{(r.inputTokens || 0).toLocaleString()}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{(r.outputTokens || 0).toLocaleString()}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{r.credits != null ? r.credits.toFixed(4) : '—'}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{r.responseTime ? (r.responseTime / 1000).toFixed(1) + 's' : '—'}</td>
      <td style={tdStyle}>
        {accountEmail(r.accountId).split('@')[0]}
        {switches > 0 && (
          <span title={switchTitle} style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 3, background: '#7c2d12', color: '#fed7aa', fontSize: 10 }}>
            ↻{switches} ({chain.join('→')})
          </span>
        )}
        {!r.success && r.error && (
          <span title={r.error} style={{ marginLeft: 6, color: '#fca5a5', fontSize: 11 }}>
            {r.error.slice(0, 40)}
          </span>
        )}
      </td>
    </tr>
  )
}

const tdStyle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #14181f', whiteSpace: 'nowrap' }

function pad2(n: number): string { return n < 10 ? '0' + n : '' + n }

function fmtBig(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
