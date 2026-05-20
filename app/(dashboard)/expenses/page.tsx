'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { useExpenses } from '@/lib/hooks/useExpenses'
import { useAuth } from '@/lib/hooks/useAuth'
import { ExpenseTable } from '@/components/expenses/ExpenseTable'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Plus, Filter } from 'lucide-react'
import type { ExpenseStatus } from '@/types'

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Submitted', value: 'submitted' },
  // Current treasury lifecycle states
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  // Legacy DB states — preserved for audit trail access
  { label: 'Cluster Approved (Legacy)', value: 'cluster_approved' },
  { label: 'Cluster Rejected (Legacy)', value: 'cluster_rejected' },
  { label: 'Accounting Approved (Legacy)', value: 'accounting_approved' },
  { label: 'Accounting Rejected (Legacy)', value: 'accounting_rejected' },
]

export default function ExpensesPage() {
  const { user } = useAuth()
  const [status, setStatus] = useState<ExpenseStatus | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { expenses, loading } = useExpenses({
    status: status || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  })

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Expenses</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''} found
          </p>
        </div>
        {user?.role === 'store_manager' && (
          <Link href="/expenses/new">
            <Button>
              <Plus size={16} />
              New Expense
            </Button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <Card>
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <Filter size={15} className="text-slate-400" />

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ExpenseStatus | '')}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <input
            type="month"
            value={dateFrom ? dateFrom.slice(0, 7) : ''}
            onChange={(e) =>
              setDateFrom(e.target.value ? `${e.target.value}-01` : '')
            }
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="From month"
          />

          <input
            type="month"
            value={dateTo ? dateTo.slice(0, 7) : ''}
            onChange={(e) =>
              setDateTo(e.target.value ? `${e.target.value}-01` : '')
            }
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="To month"
          />

          {(status || dateFrom || dateTo) && (
            <button
              onClick={() => { setStatus(''); setDateFrom(''); setDateTo('') }}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card>
        <ExpenseTable expenses={expenses} loading={loading} />
      </Card>
    </div>
  )
}
