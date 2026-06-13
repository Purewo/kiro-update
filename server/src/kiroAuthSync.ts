/**
 * Minimal stub of `kiroAuthSync` containing only the constants and helpers
 * the proxy layer (kiroApi.ts) needs. The full Electron version writes to
 * the local Kiro IDE token files — we don't do that on the web side.
 */

export const KIRO_BUILDER_ID_PLACEHOLDER_ARN = 'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX'

// AWS Builder ID + Github / Google social accounts share this fixed ARN. The
// upstream accepts requests with it (verified in our cross-account probes).
export const KIRO_SOCIAL_PROFILE_ARN = 'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK'

const PLACEHOLDER_PROFILE_ARNS = new Set<string>([KIRO_BUILDER_ID_PLACEHOLDER_ARN])

export function isPlaceholderProfileArn(arn: string | undefined | null): boolean {
  if (!arn) return false
  return PLACEHOLDER_PROFILE_ARNS.has(arn)
}
