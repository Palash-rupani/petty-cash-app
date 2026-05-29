'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { cn } from '@/lib/utils/cn'
import { Paperclip, ChevronRight } from 'lucide-react'
import { ReceiptLink } from './ReceiptLink'
import type { Expense } from '@/types'

interface ExpenseTableProps {
  expenses: Expense[]
  loading?: boolean
  /**
   * When provided, clicking a row calls this instead of navigating to the
   * detail page.  Useful for pages that mount an ExpenseDrawer alongside
   * the table (accounting, approvals, cluster-reports).
   */
  onRowClick?: (id: string) => void
  /** Highlights the row with this ID (used with onRowClick). */
  selectedExpenseId?: string
}

export function ExpenseTable({ expenses, loading, onRowClick, selectedExpenseId }: ExpenseTableProps) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (expenses.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400 text-sm">No expenses found</p>
        <p className="text-slate-300 text-xs mt-1">Try adjusting your filters</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      {/* Desktop table */}
      <table className="w-full hidden md:table">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Date</th>
            <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Category</th>
            <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 hidden lg:table-cell">Store</th>
            <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 hidden lg:table-cell">Description</th>
            <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Amount</th>
            <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Status</th>
            <th className="text-center text-xs font-medium text-slate-500 px-6 py-3">Receipt</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => {
            const isSelected = onRowClick && expense.id === selectedExpenseId
            return (
              <tr
                key={expense.id}
                onClick={onRowClick ? () => onRowClick(expense.id) : undefined}
                className={cn(
                  'border-b border-slate-50 transition-colors',
                  onRowClick
                    ? isSelected
                      ? 'bg-indigo-50 hover:bg-indigo-50/80 cursor-pointer'
                      : 'hover:bg-slate-50 cursor-pointer'
                    : 'hover:bg-slate-50'
                )}
              >
                <td className="px-6 py-3 text-sm text-slate-600 whitespace-nowrap">
                  {format(new Date(expense.created_at), 'd MMM yyyy')}
                </td>
                <td className="px-6 py-3 text-sm font-medium text-slate-700">
                  {expense.category?.name ?? '—'}
                </td>
                <td className="px-6 py-3 text-sm text-slate-600 hidden lg:table-cell">
                  {expense.store?.name ?? '—'}
                </td>
                <td className="px-6 py-3 text-sm text-slate-500 hidden lg:table-cell max-w-48 truncate">
                  {expense.description ?? '—'}
                </td>
                <td className="px-6 py-3 text-sm font-semibold text-slate-700 text-right">
                  {formatCurrency(expense.amount)}
                </td>
                <td className="px-6 py-3">
                  <Badge status={expense.status} />
                </td>
                <td className="px-6 py-3 text-center">
                  {expense.receipt_url
                    ? <ReceiptLink url={expense.receipt_url} iconOnly />
                    : <span className="text-slate-200">—</span>
                  }
                </td>
                <td className="px-4 py-3">
                  {onRowClick ? (
                    <ChevronRight size={16} className="text-slate-300" />
                  ) : (
                    <Link href={`/expenses/${expense.id}`}>
                      <ChevronRight size={16} className="text-slate-300 hover:text-slate-500 transition-colors" />
                    </Link>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-slate-100">
        {expenses.map((expense) => {
          const isSelected = onRowClick && expense.id === selectedExpenseId
          const cardContent = (
            <>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-slate-700">
                    {expense.category?.name}
                  </span>
                  {expense.receipt_url && (
                    <Paperclip size={12} className="text-slate-400" />
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {format(new Date(expense.created_at), 'd MMM')}
                  {expense.store?.name && ` · ${expense.store.name}`}
                </p>
                <div className="mt-1">
                  <Badge status={expense.status} />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <span className="text-sm font-semibold text-slate-700">
                  {formatCurrency(expense.amount)}
                </span>
                <ChevronRight size={14} className="text-slate-300" />
              </div>
            </>
          )
          return onRowClick ? (
            <div
              key={expense.id}
              onClick={() => onRowClick(expense.id)}
              className={cn(
                'flex items-center justify-between p-4 transition-colors cursor-pointer',
                isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'
              )}
            >
              {cardContent}
            </div>
          ) : (
            <Link
              key={expense.id}
              href={`/expenses/${expense.id}`}
              className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              {cardContent}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
