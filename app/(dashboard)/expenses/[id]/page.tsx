'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { format } from 'date-fns'
import { ArrowLeft, Paperclip, AlertTriangle, Clock } from 'lucide-react'
import type { Expense, AuditLog } from '@/types'

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()
  const [expense, setExpense] = useState<Expense | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchExpense = async () => {
      const { data } = await supabase
        .from('expenses')
        .select(`
          *,
          store:stores(id, name, monthly_limit),
          category:categories(id, name),
          creator:users!expenses_created_by_fkey(id, name, email)
        `)
        .eq('id', id)
        .single()

      setExpense(data as Expense | null)

      const { data: logs } = await supabase
        .from('audit_logs')
        .select('*, performer:users!audit_logs_performed_by_fkey(id, name)')
        .eq('expense_id', id)
        .order('created_at', { ascending: true })

      setAuditLogs((logs as AuditLog[]) ?? [])
      setLoading(false)
    }
    if (id) fetchExpense()
  }, [id])

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!expense) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400">Expense not found</p>
        <Button variant="ghost" onClick={() => router.back()} className="mt-3">
          Go back
        </Button>
      </div>
    )
  }

  const isRejected = expense.status.includes('rejected')
  const canEdit =
    user?.role === 'store_manager' && expense.status === 'draft' && expense.created_by === user.id

  return (
    <div className="max-w-2xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()} className="text-slate-500">
        <ArrowLeft size={16} />
        Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                {expense.category?.name ?? 'Expense'}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {expense.store?.name ?? ''} ·{' '}
                {format(new Date(expense.created_at), 'd MMM yyyy')}
              </p>
            </div>
            <Badge status={expense.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Rejection reason */}
          {isRejected && expense.rejection_reason && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700">Rejection Reason</p>
                <p className="text-sm text-red-600 mt-0.5">{expense.rejection_reason}</p>
                {isRejected && (
                  <p className="text-xs text-red-400 mt-1">
                    To resubmit, please create a new expense.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Amount</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">
                {formatCurrency(expense.amount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Month</p>
              <p className="text-sm text-slate-700 mt-1">
                {format(new Date(expense.expense_month), 'MMMM yyyy')}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Category</p>
              <p className="text-sm text-slate-700 mt-1">{expense.category?.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Submitted by</p>
              <p className="text-sm text-slate-700 mt-1">{expense.creator?.name ?? '—'}</p>
            </div>
          </div>

          {expense.description && (
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Description</p>
              <p className="text-sm text-slate-700 mt-1">{expense.description}</p>
            </div>
          )}

          {expense.receipt_url && (
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-1">Receipt</p>
              <a
                href={expense.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <Paperclip size={14} />
                View Receipt
              </a>
            </div>
          )}

          {canEdit && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-400 mb-2">
                This draft is only visible to you. Submit it to send for approval.
              </p>
              <Button size="sm">Submit for Approval</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      {auditLogs.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-slate-800">Activity History</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3">
                  <div className="mt-0.5 p-1 bg-slate-100 rounded-full flex-shrink-0">
                    <Clock size={11} className="text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">
                      <span className="font-medium">
                        {(log.performer as { name: string } | null)?.name ?? 'System'}
                      </span>{' '}
                      {log.action.replace(/_/g, ' ')}
                    </p>
                    {log.remarks && (
                      <p className="text-xs text-slate-400 mt-0.5">{log.remarks}</p>
                    )}
                    <p className="text-xs text-slate-300 mt-0.5">
                      {format(new Date(log.created_at), 'd MMM yyyy, h:mm a')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
