/**
 * Computes the estimated cash runway in days.
 *
 * Formula: Math.floor(balance / avgDailyBurn)
 *
 * Returns null when:
 *   - balance is null (fetch failed — do not display a potentially misleading value)
 *   - balance is negative (store is already overdrawn; the caller should surface
 *     the negative balance directly rather than show a confusing negative runway)
 *   - avgDailyBurn is 0 or negative (no burn history yet — runway is undefined)
 */
export function computeRunway(
  balance: number | null,
  avgDailyBurn: number
): number | null {
  if (balance === null || balance < 0 || avgDailyBurn <= 0) return null
  return Math.floor(balance / avgDailyBurn)
}

/** Severity tier for a runway value (null = unknown, treated as neutral). */
export type RunwaySeverity = 'healthy' | 'low' | 'critical'

export function getRunwaySeverity(runway: number | null): RunwaySeverity {
  if (runway === null) return 'healthy' // unknown — don't alarm
  if (runway < 7) return 'critical'
  if (runway < 14) return 'low'
  return 'healthy'
}
