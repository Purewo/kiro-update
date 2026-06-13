import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { Account } from '../api'

export function AccountsView() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [filter, setFilter] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const r = await api.listAccounts()
      setAccounts(r.accounts || [])
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { refresh() }, [])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length === 0) return
    setBusy(true); setErr(''); setInfo('')
    try {
      const r = await api.importAccountsFile(files)
      const failed = r.fileErrors?.length ?? 0
      const summary = `导入完成：${files.length} 个文件，新增 ${r.added}，更新 ${r.updated}，共 ${r.total}`
      setInfo(failed > 0 ? `${summary}（${failed} 个文件解析失败）` : summary)
      if (failed > 0) {
        setErr('部分文件失败：' + r.fileErrors!.map(fe => `${fe.name}: ${fe.error}`).join('；'))
      }
      await refresh()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const onPaste = async () => {
    if (!pasteText.trim()) {
      setErr('请粘贴 JSON 内容')
      return
    }
    setBusy(true); setErr(''); setInfo('')
    try {
      const r = await api.importAccountsPaste(pasteText.trim())
      setInfo(`粘贴导入完成：新增 ${r.added}，更新 ${r.updated}，共 ${r.total}`)
      setPasteText('')
      setPasteOpen(false)
      await refresh()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(a =>
      (a.email || '').toLowerCase().includes(q) ||
      (a.nickname || '').toLowerCase().includes(q) ||
      (a.provider || '').toLowerCase().includes(q),
    )
  }, [accounts, filter])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>账号</h2>
        <span className="muted" style={{ fontSize: 13 }}>共 {accounts.length} 个</span>
        <div style={{ flex: 1 }} />
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="搜索邮箱/昵称/提供方…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <input ref={fileRef} type="file" accept="application/json" multiple onChange={onFile} style={{ display: 'none' }} />
        <button className="btn secondary" disabled={busy} onClick={() => setPasteOpen(true)}>粘贴 JSON</button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>导入 JSON（可多选）</button>
      </div>

      {pasteOpen && (
        <div
          onClick={() => setPasteOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', zIndex: 100 }}
        >
          <div onClick={e => e.stopPropagation()} className="card" style={{ width: 'min(640px, 92vw)', margin: 0 }}>
            <h3 style={{ marginTop: 0 }}>粘贴账号 JSON</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              支持以下三种格式（任一即可）：
              <br />① Manager 复制按钮的 4 字段 <code>{'{ accessToken, refreshToken, clientId, clientSecret }'}</code>
              <br />② 完整账号对象（带 <code>credentials</code>/<code>subscription</code>/<code>usage</code>）
              <br />③ 多账号批量 <code>{'{ "accounts": [ ... ] }'}</code> 或扁平数组
            </p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              autoFocus
              placeholder='{"accessToken":"...","refreshToken":"...","clientId":"...","clientSecret":"..."}'
              spellCheck={false}
              style={{
                width: '100%', minHeight: 220, padding: 10, borderRadius: 6,
                background: '#0f1218', color: '#e7e9ee', border: '1px solid #20242f',
                fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn secondary" onClick={() => { setPasteOpen(false); setPasteText('') }}>取消</button>
              <button className="btn" disabled={busy || !pasteText.trim()} onClick={onPaste}>导入</button>
            </div>
          </div>
        </div>
      )}

      {err && <div className="card" style={{ borderColor: '#7f1d1d', color: '#fca5a5' }}>{err}</div>}
      {info && <div className="card" style={{ borderColor: '#14532d', color: '#4ade80' }}>{info}</div>}

      {!loaded ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>加载账号列表…</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>暂无账号。</p>
          <p>从 Manager 桌面端导出 JSON 后点上方「导入 JSON」上传。支持顶层 <code>accounts</code> 数组、扁平账号数组、单个账号对象等格式。</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {visible.map(a => (
            <AccountCard key={a.id} acc={a} busy={busy} setBusy={setBusy} setErr={setErr} setInfo={setInfo} refresh={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  acc: Account
  busy: boolean
  setBusy: (b: boolean) => void
  setErr: (s: string) => void
  setInfo: (s: string) => void
  refresh: () => Promise<void>
}

function AccountCard({ acc, busy, setBusy, setErr, setInfo, refresh }: CardProps) {
  const [showDetails, setShowDetails] = useState(false)
  const sub = acc.subscription
  const u = acc.usage
  const used = u?.current ?? acc.quotaUsed ?? 0
  const limit = u?.limit ?? acc.quotaLimit ?? 0
  const pct = limit > 0 ? Math.min(999, Math.round((used / limit) * 100)) : 0
  const overage = pct > 100
  const barColor = overage ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#3b82f6'
  const resetAt = u?.nextResetDate
    ? (typeof u.nextResetDate === 'string' ? new Date(u.nextResetDate) : new Date(u.nextResetDate as number))
    : (acc.quotaResetAt ? new Date(acc.quotaResetAt) : null)
  const tokenRemaining = formatRemaining(acc.expiresAt)
  const subDays = sub?.daysRemaining

  const provider = acc.provider || acc.idp
  const subTitle = sub?.title || (sub?.type ? `KIRO ${sub.type.toUpperCase()}` : null)
  // PRO+ → purple, POWER → orange, PRO → blue, otherwise gray (matches the
  // desktop Manager palette so users can recognize tier at a glance).
  const subColor = subTitle?.includes('PRO+') ? '#a855f7'
    : subTitle?.includes('POWER') ? '#f59e0b'
    : subTitle?.includes('PRO') ? '#3b82f6'
    : '#6b7280'

  let statusBadge: { text: string; cls: string } = { text: '已启用', cls: 'green' }
  if (acc.suspendedAt) statusBadge = { text: '已暂停', cls: 'red' }
  else if (acc.enabled === false) statusBadge = { text: '已禁用', cls: 'gray' }

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  const onToggle = () => wrap(async () => { await api.updateAccount(acc.id, { enabled: !(acc.enabled !== false) }); await refresh() })
  const onRefreshToken = () => wrap(async () => {
    const r = await api.refreshAccount(acc.id)
    setInfo(`Token 已刷新（${acc.email || acc.id.slice(0, 8)}）`)
    await refresh()
    void r
  })
  const onQuerySub = () => wrap(async () => {
    const r = await api.querySubscription(acc.id)
    setInfo(r.error ? `订阅查询失败：${r.error}` : `订阅查询完成`)
    await refresh()
  })
  const onTest = () => wrap(async () => {
    const r = await api.testAccount(acc.id)
    setInfo(r.error ? `测试失败：${r.error}` : `测试通过：可访问 ${r.modelCount || 0} 个模型`)
  })
  const onCopyJson = () => {
    // Reproduce the desktop Manager export shape so the copied blob can be
    // pasted into a Manager-format JSON file or re-imported here verbatim.
    const a = acc as Account & {
      accessToken?: string; refreshToken?: string; clientId?: string; clientSecret?: string
      startUrl?: string; csrfToken?: string; userId?: string; machineId?: string
      groupId?: string; createdAt?: number; lastCheckedAt?: number; tags?: unknown[]
    }
    const exported = {
      email: a.email,
      userId: a.userId,
      nickname: a.nickname,
      idp: a.idp || a.provider,
      credentials: {
        accessToken: a.accessToken,
        csrfToken: a.csrfToken || '',
        refreshToken: a.refreshToken,
        clientId: a.clientId || '',
        clientSecret: a.clientSecret || '',
        region: a.region || 'us-east-1',
        startUrl: a.startUrl,
        expiresAt: a.expiresAt,
        authMethod: a.authMethod,
        provider: a.provider,
      },
      subscription: a.subscription,
      usage: a.usage,
      tags: a.tags || [],
      status: a.status || 'active',
      lastUsedAt: a.lastUsedAt,
      id: a.id,
      machineId: a.machineId,
      createdAt: a.createdAt,
      lastCheckedAt: a.lastCheckedAt,
    }
    void navigator.clipboard.writeText(JSON.stringify(exported, null, 2))
    setInfo(`已复制账号 JSON：${a.email || a.id.slice(0, 8)}`)
  }
  const onDelete = () => {
    if (!confirm(`确认删除账号 ${acc.email || acc.id}？`)) return
    void wrap(async () => { await api.deleteAccount(acc.id); await refresh() })
  }

  return (
    <div className="card" style={{ position: 'relative', padding: 18 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {acc.email || acc.nickname || acc.id.slice(0, 8) + '…'}
          </div>
          {acc.nickname && acc.email && acc.nickname !== acc.email && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{acc.nickname}</div>
          )}
        </div>
        <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
      </div>

      {/* tags: subscription / provider */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {subTitle && <span className="badge" style={{ background: subColor, color: '#fff' }}>{subTitle}</span>}
        {provider && <span className="badge gray">{provider}</span>}
      </div>

      {/* usage */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span className="muted">使用量</span>
          <span style={{ color: overage ? '#fca5a5' : '#cbd1de', fontWeight: 500 }}>
            {pct}%{overage ? ' 超额' : ''}
          </span>
        </div>
        <div style={{ background: '#0f1218', height: 6, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, background: barColor, height: '100%', transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8a8f9c', marginTop: 6 }}>
          <span>{Math.round(used).toLocaleString()} / {limit.toLocaleString()}</span>
          {resetAt && <span>{resetAt.toLocaleDateString()} 重置</span>}
        </div>
      </div>

      {/* token / sub days */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12, color: '#8a8f9c' }}>
        <span>📅 {typeof subDays === 'number' ? `订阅剩余 ${subDays} 天` : (resetAt ? `下次重置 ${resetAt.toLocaleDateString()}` : '—')}</span>
        <span>🔐 Token {tokenRemaining}</span>
      </div>

      {/* footer: action icons */}
      <div style={{ display: 'flex', gap: 4, marginTop: 14, paddingTop: 14, borderTop: '1px solid #1c2030', justifyContent: 'flex-end' }}>
        <IconBtn busy={busy} title={acc.enabled === false ? '启用' : '禁用'} onClick={onToggle}>{acc.enabled === false ? '▶' : '⏻'}</IconBtn>
        <IconBtn busy={busy} title="查询订阅" onClick={onQuerySub}>↻</IconBtn>
        <IconBtn busy={busy} title="刷新 Token" onClick={onRefreshToken}>🔑</IconBtn>
        <IconBtn busy={busy} title="模型列表测试" onClick={onTest}>🧪</IconBtn>
        <IconBtn busy={busy} title="复制账号 JSON" onClick={onCopyJson}>⎘</IconBtn>
        <IconBtn busy={busy} title={showDetails ? '收起详情' : '展开详情'} onClick={() => setShowDetails(s => !s)}>{showDetails ? '▲' : 'ⓘ'}</IconBtn>
        <IconBtn busy={busy} title="删除" onClick={onDelete} danger>🗑</IconBtn>
      </div>

      {showDetails && (
        <div style={{ marginTop: 12, padding: 12, background: '#0f1218', border: '1px solid #1c2030', borderRadius: 6, fontSize: 12 }}>
          <DetailRow label="账号 ID" value={acc.id} mono />
          <DetailRow label="提供方" value={provider} />
          <DetailRow label="认证方式" value={acc.authMethod} />
          <DetailRow label="区域" value={acc.region} />
          <DetailRow label="订阅" value={subTitle} />
          <DetailRow label="配额" value={limit > 0 ? `${Math.round(used).toLocaleString()} / ${limit.toLocaleString()} (${pct}%)` : null} />
          <DetailRow label="Token 过期" value={acc.expiresAt ? new Date(acc.expiresAt).toLocaleString() : null} />
          <DetailRow label="配额重置" value={resetAt ? resetAt.toLocaleString() : null} />
          <DetailRow label="profileArn" value={acc.profileArn} mono />
          <DetailRow label="最近使用" value={acc.lastUsedAt ? new Date(acc.lastUsedAt).toLocaleString() : null} />
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
      <span style={{ width: 90, color: '#8a8f9c', flexShrink: 0 }}>{label}</span>
      <span style={{ wordBreak: 'break-all', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{value}</span>
    </div>
  )
}

function IconBtn({ children, title, onClick, busy, danger }: { children: React.ReactNode; title: string; onClick: () => void; busy: boolean; danger?: boolean }) {
  return (
    <button
      title={title}
      disabled={busy}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid #1c2030',
        color: danger ? '#fca5a5' : '#9ba3b4',
        width: 30,
        height: 30,
        borderRadius: 6,
        cursor: busy ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        transition: 'background .15s, color .15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? '#7f1d1d' : '#1c2030', e.currentTarget.style.color = '#fff')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = danger ? '#fca5a5' : '#9ba3b4')}
    >
      {children}
    </button>
  )
}

function formatRemaining(expiresAt?: number): string {
  if (!expiresAt) return '—'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return '已过期'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `剩 ${min} 分钟`
  const hr = Math.floor(min / 60)
  if (hr < 48) return `剩 ${hr} 小时`
  const d = Math.floor(hr / 24)
  return `剩 ${d} 天`
}
