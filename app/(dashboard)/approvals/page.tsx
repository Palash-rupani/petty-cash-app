'use client'

export const dynamic = 'force-dynamic'

import { format } from 'date-fns'
import { useApprovals } from '@/lib/hooks/useApprovals'
import { useAuth } from '@/lib/hooks/useAuth'
import { ApprovalActions } from '@/components/approvals/ApprovalActions'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { Paperclip, Clock, CheckSquare } from 'lucide-react'

export default function ApprovalsPage() {
  const { user } = useAuth()
  const { pendingExpenses, loading, refetch } = useApprovals()

  if (!user || (user.role !== 'cluster_manager' && user.role !== 'accounting')) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">You don&apos;t have access to this page.</p>
      </div>
    )
  }

  const queueLabel =
    user.role === 'cluster_manager'
      ? 'Submitted expenses waiting for your cluster review'
      : 'Cluster-approved expenses waiting for accounting sign-off'

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
                    className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
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
                    <td className="px-6 py-3 text-center">
                      {expense.receipt_url ? (
                        <a
                          href={expense.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:text-indigo-700"
                          title="View receipt"
                        >
                          <Paperclip size={14} className="mx-auto" />
                        </a>
                      ) : (
                        <span className="text-slate-200">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
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
              <div key={expense.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-800">{expense.store?.name}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {expense.category?.name} · {format(new Date(expense.created_at), 'd MMM yyyy')}
                    </p>
                    {expense.receipt_url && (
                      <a
                        href={expense.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 mt-1"
                      >
                        <Paperclip size={11} />
                        View receipt
                      </a>
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
    </div>
  )
}
