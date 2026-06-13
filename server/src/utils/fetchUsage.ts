/**
 * Fetch the usage / subscription block for an account from the Kiro REST API,
 * mirroring what the desktop Manager does at startup. The web build needs this
 * after importing a bare-bones JSON (e.g. snake_case `access_token + ...` only)
 * so the account card can show subscription title / quota / reset date.
 *
 * Endpoint:  GET https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits
 *            ?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&isEmailRequired=true
 *            [&profileArn=...]
 * Headers:   Authorization: Bearer <accessToken>; AWS SDK UA strings.
 *
 * Returns a normalized object suitable for direct merge into ProxyAccount:
 *   { subscription: {...}, usage: {...}, email?, userId? }
 */
import { fetch as undiciFetch, type RequestInit as UndiciRequestInit, ProxyAgent } from 'undici'

const REST_BASES = [
  'https://codewhisperer.us-east-1.amazonaws.com',
  'https://q.us-east-1.amazonaws.com',
]

interface UsageBreakdown {
  resourceType?: string
  displayName?: string
  displayNamePlural?: string
  currentUsage?: number
  currentUsageWithPrecision?: number
  usageLimit?: number
  usageLimitWithPrecision?: number
  currency?: string
  unit?: string
  overageRate?: number
  overageCap?: number
  freeTrialInfo?: {
    currentUsage?: number
    usageLimit?: number
    freeTrialStatus?: string
    freeTrialExpiry?: number | string
  }
  bonuses?: Array<{
    bonusCode?: string
    displayName?: string
    description?: string
    usageLimit?: number
    currentUsage?: number
    expiresAt?: number | string
    redeemedAt?: number | string
    status?: string
  }>
}

interface UsageLimitsResponse {
  usageBreakdownList?: UsageBreakdown[]
  nextDateReset?: number | string
  subscriptionInfo?: {
    subscriptionName?: string
    subscriptionTitle?: string
    subscriptionType?: string
    status?: string
    upgradeCapability?: string
    overageCapability?: string
  }
  overageSettings?: { overageStatus?: string }
  overageConfiguration?: { overageEnabled?: boolean; overageStatus?: string }
  userInfo?: { email?: string; userId?: string }
}

/** Normalized blob to merge into ProxyAccount + display-only fields. */
export interface UsageSnapshot {
  subscription: {
    type?: string
    title?: string
    daysRemaining?: number
    expiresAt?: number
    managementTarget?: string
    upgradeCapability?: string
    overageCapability?: string
  }
  usage: {
    current?: number
    limit?: number
    percentUsed?: number
    nextResetDate?: string
    resourceDetail?: { displayName?: string; currency?: string; overageRate?: number; overageCap?: number; unit?: string }
    bonuses?: UsageBreakdown['bonuses']
    freeTrialInfo?: UsageBreakdown['freeTrialInfo']
  }
  email?: string
  userId?: string
  // Convenience scalars also persisted directly on the account so the card can
  // show progress without subscription/usage being present.
  quotaUsed?: number
  quotaLimit?: number
  quotaResetAt?: number
}

async function fetchAt(base: string, accessToken: string, profileArn: string | undefined, proxyUrl?: string): Promise<UsageLimitsResponse | { httpStatus: number; body: string }> {
  const params = new URLSearchParams({
    origin: 'AI_EDITOR',
    resourceType: 'AGENTIC_REQUEST',
    isEmailRequired: 'true',
  })
  if (profileArn) params.set('profileArn', profileArn)
  const url = `${base}/getUsageLimits?${params.toString()}`
  const init: UndiciRequestInit = {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'aws-sdk-js/2.x kiro-web/0.1.0',
      'x-amz-user-agent': 'kiro-web/0.1.0',
    },
  }
  if (proxyUrl) {
    init.dispatcher = new ProxyAgent(proxyUrl)
  }
  const res = await undiciFetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { httpStatus: res.status, body }
  }
  return (await res.json()) as UsageLimitsResponse
}

/**
 * Fetch usage + subscription for an account, transparently failing over from
 * codewhisperer.* to q.us-east-1.* on 403 (matching Manager's fallback).
 */
export async function fetchUsageSnapshot(opts: {
  accessToken: string
  profileArn?: string
  proxyUrl?: string
}): Promise<UsageSnapshot | { error: string }> {
  let lastErr: { httpStatus: number; body: string } | null = null
  for (const base of REST_BASES) {
    const r = await fetchAt(base, opts.accessToken, opts.profileArn, opts.proxyUrl)
    if (!('httpStatus' in r)) return normalize(r)
    lastErr = r
    if (r.httpStatus !== 403) break // only fall over on 403
  }
  return { error: lastErr ? `HTTP ${lastErr.httpStatus}: ${lastErr.body.slice(0, 200)}` : 'unknown' }
}

function normalize(raw: UsageLimitsResponse): UsageSnapshot {
  // Upstream returns resourceType="CREDIT" for credit-based plans (KIRO PRO+)
  // and "AGENTIC_REQUEST" for legacy request-based plans. Accept both, fall
  // back to first row.
  const list = raw.usageBreakdownList || []
  const breakdown =
    list.find(b => (b.resourceType || '').toUpperCase() === 'CREDIT') ||
    list.find(b => (b.resourceType || '').toUpperCase() === 'AGENTIC_REQUEST') ||
    list[0]
  const current = breakdown?.currentUsageWithPrecision ?? breakdown?.currentUsage ?? 0
  const limit = breakdown?.usageLimitWithPrecision ?? breakdown?.usageLimit ?? 0

  let nextResetIso: string | undefined
  if (typeof raw.nextDateReset === 'number') {
    nextResetIso = new Date(raw.nextDateReset * 1000).toISOString()
  } else if (typeof raw.nextDateReset === 'string') {
    nextResetIso = raw.nextDateReset
  }

  const quotaResetAt = nextResetIso ? Date.parse(nextResetIso) : undefined
  const subTitle = raw.subscriptionInfo?.subscriptionTitle
  const subType = raw.subscriptionInfo?.subscriptionType

  // Days remaining from next reset (closest the upstream gives us — Manager
  // uses the same heuristic when no explicit "daysRemaining" is in the body).
  let daysRemaining: number | undefined
  if (quotaResetAt) {
    const ms = quotaResetAt - Date.now()
    if (ms > 0) daysRemaining = Math.ceil(ms / 86_400_000)
  }

  return {
    subscription: {
      type: subType,
      title: subTitle,
      daysRemaining,
      expiresAt: quotaResetAt,
      upgradeCapability: raw.subscriptionInfo?.upgradeCapability,
      overageCapability: raw.subscriptionInfo?.overageCapability,
    },
    usage: {
      current,
      limit,
      percentUsed: limit > 0 ? current / limit : 0,
      nextResetDate: nextResetIso,
      resourceDetail: {
        displayName: breakdown?.displayName,
        currency: breakdown?.currency,
        overageRate: breakdown?.overageRate,
        overageCap: breakdown?.overageCap,
        unit: breakdown?.unit,
      },
      bonuses: breakdown?.bonuses,
      freeTrialInfo: breakdown?.freeTrialInfo,
    },
    email: raw.userInfo?.email,
    userId: raw.userInfo?.userId,
    quotaUsed: current,
    quotaLimit: limit,
    quotaResetAt,
  }
}
