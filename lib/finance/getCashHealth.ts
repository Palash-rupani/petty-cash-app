/**
 * Treasury cash-health classification.
 *
 * Thresholds (relative to target float):
 *   negative — balance < 0
 *   low      — balance >= 0 but < 25 % of target float
 *   healthy  — balance >= 25 % of target float
 *
 * When targetFloat is 0 only the negative case is flagged;
 * a zero-float store with a non-negative balance is considered healthy.
 */

export type CashHealth = 'healthy' | 'low' | 'negative'

export function getCashHealth(balance: number, targetFloat: number): CashHealth {
  if (balance < 0) return 'negative'
  if (targetFloat > 0 && balance < targetFloat * 0.25) return 'low'
  return 'healthy'
}

// UI configuration for each health state — colours only, no business logic.
export const CASH_HEALTH_CONFIG = {
  healthy: {
    label: 'Healthy',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  low: {
    label: 'Low Float',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  negative: {
    label: 'Negative',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
} satisfies Record<CashHealth, { label: string; color: string; bg: string; border: string; dot: string }>
