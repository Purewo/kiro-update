/**
 * Token refresh logic — moved out of the Electron main process so the web
 * server can run it. Two flavors:
 *   - OIDC (IdC / BuilderId / Enterprise): POST oidc.{region}.amazonaws.com/token
 *   - Social (GitHub/Google):              POST prod.us-east-1.auth.desktop.kiro.dev/refreshToken
 *
 * Returns {success, accessToken?, refreshToken?, expiresIn?}.
 */
import { fetch as undiciFetch, ProxyAgent, type RequestInit as UndiciRequestInit } from 'undici'

const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev'

export interface RefreshResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  error?: string
}

async function fetchMaybeProxied(url: string, init: UndiciRequestInit, proxyUrl?: string): Promise<Response> {
  if (proxyUrl) {
    init.dispatcher = new ProxyAgent(proxyUrl) as never
  }
  return (await undiciFetch(url, init)) as unknown as Response
}

async function refreshOidcToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  region = 'us-east-1',
  proxyUrl?: string,
): Promise<RefreshResult> {
  const url = `https://oidc.${region}.amazonaws.com/token`
  try {
    const res = await fetchMaybeProxied(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: 'refresh_token' }),
      },
      proxyUrl,
    )
    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `OIDC refresh HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string; expiresIn?: number }
    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresIn: data.expiresIn,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function refreshSocialToken(refreshToken: string, proxyUrl?: string): Promise<RefreshResult> {
  const url = `${KIRO_AUTH_ENDPOINT}/refreshToken`
  try {
    const res = await fetchMaybeProxied(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      },
      proxyUrl,
    )
    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `Social refresh HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string; expiresIn?: number }
    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresIn: data.expiresIn,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function refreshTokenByMethod(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  region = 'us-east-1',
  authMethod?: string,
  proxyUrl?: string,
): Promise<RefreshResult> {
  if (authMethod === 'social') {
    return refreshSocialToken(refreshToken, proxyUrl)
  }
  return refreshOidcToken(refreshToken, clientId, clientSecret, region, proxyUrl)
}
