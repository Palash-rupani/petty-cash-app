'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { format } from 'date-fns'
import { useApprovals } from '@/lib/hooks/useApprovals'
import { useAuth } from '@/lib/hooks/useAuth'
import { ApprovalActions } from '@/components/approvals/ApprovalActions'
import { ExpenseDrawer } from '@/components/expenses/ExpenseDrawer'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { cn } from '@/lib/utils/cn'
import { Clock, CheckSquare } from 'lucide-react'
import { ReceiptLink } from '@/components/expenses/ReceiptLink'

export default function ApprovalsPage() {
  const { user } = useAuth()
  const { pendingExpenses, loading, refetch } = useApprovals()
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null)

  const toggleDrawer = (id: string) =>
    setSelectedExpenseId(prev => prev === id ? null : id)

  if (!user || (user.role !== 'cluster_manager' && user.role !== 'accounting')) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">You don&apos;t have access to this page.</p>
      </div>
    )
  }

  const queueLabel =
    user.role === 'cluster_manager'
      ? 'Submitted expenses awaiting your final approval'
      : 'Supervisory review — expenses approved by cluster managers'

  return (
    <div className="max-w-5xl space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-800">Approvals</h2>
        <p className="text-sm text-slate-500 mt-0.5">{queueLabel}</p>
      </div>

      {/* Queue */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : pendingExpenses.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
              <CheckSquare size={22} className="text-green-500" />
            </div>
            <p className="text-slate-600 font-medium">All caught up!</p>
            <p className="text-slate-400 text-sm mt-1">No expenses pending your approval</p>
          </div>
        </Card>
      ) : (
        <Card>
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Store</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Category</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Amount</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Submitted</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Submitted by</th>
                  <th className="text-center text-xs font-medium text-slate-500 px-6 py-3">Receipt</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingExpenses.map((expense) => (
                  <tr
                    key={expense.id}
                    onClick={() => toggleDrawer(expense.id)}
                    className={cn(
                      'border-b border-slate-50 cursor-pointer transition-colors',
                      expense.id === selectedExpenseId
                        ? 'bg-indigo-50 hover:bg-indigo-50/80'
                        : 'hover:bg-slate-50'
                    )}
                  >
                    <td className="px-6 py-3 text-sm font-medium text-slate-700">
                      {expense.store?.name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-600">
                      {expense.category?.name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-slate-700 text-right">
                      {formatCurrency(expense.amount)}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-slate-300" />
                        {format(new Date(expense.created_at), 'd MMM yyyy')}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-500">
                      {expense.creator?.name ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-center" onClick={e => e.stopPropagation()}>
                      {expense.receipt_url
                        ? <ReceiptLink url={expense.receipt_url} iconOnly />
                        : <span className="text-slate-200">—</span>
                      }
                    </td>
                    <td className="px-6 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <ApprovalActions
                        expenseId={expense.id}
                        storeId={expense.store_id}
                        expenseAmount={expense.amount}
                        userRole={user.role}
                        onDone={refetch}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {pendingExpenses.map((expense) => (
              <div
                key={expense.id}
                className={cn(
                  'p-4 space-y-3 transition-colors',
                  expense.id === selectedExpenseId ? 'bg-indigo-50' : ''
                )}
              >
                <div
                  className="flex items-start justify-between gap-3 cursor-pointer"
                  onClick={() => toggleDrawer(expense.id)}
                >
                  <div>
                    <p className="font-medium text-slate-800">{expense.store?.name}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {expense.category?.name} · {format(new Date(expense.created_at), 'd MMM yyyy')}
                    </p>
                    {expense.receipt_url && (
                      <ReceiptLink
                        url={expense.receipt_url}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 mt-1"
                      />
                    )}
                  </div>
                  <p className="text-base font-bold text-slate-800 flex-shrink-0">
                    {formatCurrency(expense.amount)}
                  </p>
                </div>
                <div className="flex justify-end">
                  <ApprovalActions
                    expenseId={expense.id}
                    storeId={expense.store_id}
                    expenseAmount={expense.amount}
                    userRole={user.role}
                    onDone={refetch}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-slate-400">
        {pendingExpenses.length} expense{pendingExpenses.length !== 1 ? 's' : ''} pending
      </p>

      {/* Expense detail drawer — click any row to inspect */}
      <ExpenseDrawer
        expenseId={selectedExpenseId}
        onClose={() => setSelectedExpenseId(null)}
      />
    </div>
  )
}
