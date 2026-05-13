'use client'

import Link from 'next/link'
import { useExpenses } from '@/lib/hooks/useExpenses'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { Badge } from '@/components/ui/Badge'
import { format } from 'date-fns'
import { ArrowRight } from 'lucide-react'

export function RecentExpenses() {
  const { expenses, loading } = useExpenses()
  const recent = expenses.slice(0, 5)

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (recent.length === 0) {
    return (
      <p className="text-sm text-slate-400 text-center py-6">
        No expenses yet. Create your first expense.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {recent.map((expense) => (
        <Link
          key={expense.id}
          href={`/expenses/${expense.id}`}
          className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700 truncate">
              {expense.category?.name ?? 'Unknown'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {format(new Date(expense.created_at), 'd MMM yyyy')}
              {expense.description && ` · ${expense.description.slice(0, 40)}`}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-3">
            <Badge status={expense.status} />
            <span className="text-sm font-semibold text-slate-700">
              {formatCurrency(expense.amount)}
            </span>
            <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
          </div>
        </Link>
      ))}
    </div>
  )
}
