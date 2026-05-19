import { cn } from '@/lib/utils/cn'
import type { ExpenseStatus } from '@/types'

interface BadgeProps {
  status: ExpenseStatus
  className?: string
}

const statusConfig: Record<ExpenseStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600' },
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-700' },
  cluster_approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  cluster_rejected: { label: 'Cluster Rejected', className: 'bg-red-100 text-red-700' },
  accounting_approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  accounting_rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
  synced_to_tally: { label: 'Synced to Tally', className: 'bg-emerald-100 text-emerald-700' },
  tally_sync_failed: { label: 'Tally Sync Failed', className: 'bg-orange-100 text-orange-700' },
}

export function Badge({ status, className }: BadgeProps) {
  const config = statusConfig[status]
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
