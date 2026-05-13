'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { Paperclip, ArrowRight, AlertTriangle } from 'lucide-react'
import type { Expense } from '@/types'

interface ExpenseCardProps {
  expense: Expense
}

export function ExpenseCard({ expense }: ExpenseCardProps) {
  const isRejected = expense.status.includes('rejected')

  return (
    <Link
      href={`/expenses/${expense.id}`}
      className="block bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge status={expense.status} />
            {expense.receipt_url && (
              <Paperclip size={12} className="text-slate-400" />
            )}
          </div>
          <p className="font-semibold text-slate-800 text-base">
            {formatCurrency(expense.amount)}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">
            {expense.category?.name ?? '—'}
          </p>
          {expense.description && (
            <p className="text-xs text-slate-400 mt-1 truncate">{expense.description}</p>
          )}
          <p className="text-xs text-slate-400 mt-2">
            {format(new Date(expense.created_at), 'd MMM yyyy')}
            {expense.store?.name && ` · ${expense.store.name}`}
          </p>
        </div>
        <ArrowRight size={16} className="text-slate-300 flex-shrink-0 mt-1" />
      </div>

      {isRejected && expense.rejection_reason && (
        <div className="mt-3 flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-100">
          <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-600">{expense.rejection_reason}</p>
        </div>
      )}
    </Link>
  )
}
