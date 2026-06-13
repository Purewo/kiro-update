/**
 * No-op kproxy stub for the web build.
 *
 * The Electron app embeds a local MITM proxy ("kproxy") that rewrites the
 * machineId on outbound Kiro API calls. The web service does not run a MITM —
 * accounts use whatever device fingerprint they already have. These stubs let
 * the existing proxy code compile and behave as if kproxy is permanently off.
 */

interface KProxyConfig {
  host: string
  port: number
  enabled: boolean
}

interface DeviceIdMapping {
  accountId: string
  deviceId: string
  description?: string
  createdAt?: number
}

interface KProxyServiceStub {
  isRunning(): boolean
  getConfig(): KProxyConfig
  getDeviceIdForAccount(accountId: string): string | undefined
  switchToAccount(accountId: string): boolean
  addDeviceIdMapping(mapping: DeviceIdMapping): void
  setDeviceId(deviceId: string): void
}

const stub: KProxyServiceStub = {
  isRunning: () => false,
  getConfig: () => ({ host: '127.0.0.1', port: 0, enabled: false }),
  getDeviceIdForAccount: () => undefined,
  switchToAccount: () => false,
  addDeviceIdMapping: () => {},
  setDeviceId: () => {},
}

export function getKProxyService(): KProxyServiceStub | null {
  return stub
}

/** kproxy normally generates a fresh 64-char hex device id; in the web build
 * we keep this around so proxyServer compiles, but it is never reached because
 * isRunning() always returns false. */
export function generateDeviceId(): string {
  // Returning a deterministic placeholder is fine since this is not used in
  // the web service path; kproxy-driven rotation is unreachable here.
  return '0'.repeat(64)
}
