import { cn } from '@/lib/utils/cn'

import {
  normalizeExpenseStatus,
  type ExpenseStatus,
  type TreasuryLifecycleStatus,
} from '@/types'

interface BadgeProps {
  status: ExpenseStatus
  className?: string
}

/**
 * Treasury-normalized badge semantics.
 *
 * IMPORTANT:
 * UI should render normalized treasury states,
 * not raw DB compatibility states.
 */
const normalizedStatusConfig: Record<
  TreasuryLifecycleStatus,
  {
    label: string
    className: string
  }
> = {

  draft: {
    label: 'Draft',
    className:
      'bg-slate-100 text-slate-600',
  },

  submitted: {
    label: 'Submitted',
    className:
      'bg-blue-100 text-blue-700',
  },

  approved: {
    label: 'Approved',
    className:
      'bg-green-100 text-green-700',
  },

  rejected: {
    label: 'Rejected',
    className:
      'bg-red-100 text-red-700',
  },
}

export function Badge({
  status,
  className,
}: BadgeProps) {

  /**
   * Normalize raw DB lifecycle state
   * into treasury lifecycle state.
   */
  const normalizedStatus =
    normalizeExpenseStatus(status)

  const config =
    normalizedStatusConfig[
    normalizedStatus
    ]

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}