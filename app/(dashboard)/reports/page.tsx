'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { exportCSV } from '@/lib/utils/exportCSV'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Download, BarChart3, Plus, Wallet } from 'lucide-react'
import { format } from 'date-fns'

interface ReportRow {
  store: string
  cluster: string
  total_expenses: number
  approved_amount: number
  pending_amount: number
  rejected_amount: number
  expense_count: number
}

export default function ReportsPage() {
  const { user } = useAuth()
  const supabase = createClient()

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [data, setData] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [clusters, setClusters] = useState<{ id: string; name: string }[]>([])
  const [selectedCluster, setSelectedCluster] = useState('')
  
  // Top-up form state
  const [allStores, setAllStores] = useState<{ id: string, name: string }[]>([])
  const [topUpStore, setTopUpStore] = useState('')
  const [topUpAmount, setTopUpAmount] = useState('')
  const [topUpRemarks, setTopUpRemarks] = useState('')
  const [topUpLoading, setTopUpLoading] = useState(false)
  const [topUpSuccess, setTopUpSuccess] = useState(false)
  const [topUpError, setTopUpError] = useState<string | null>(null)

  useEffect(() => {
    const fetchClusters = async () => {
      const { data: clusterData } = await supabase.from('clusters').select('id, name').order('name')
      setClusters(clusterData ?? [])
    }
    const fetchAllStores = async () => {
      const { data: storeData } = await supabase.from('stores').select('id, name').order('name')
      setAllStores(storeData ?? [])
    }
    fetchClusters()
    fetchAllStores()
  }, [])

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true)
      const monthStart = `${month}-01`
      const nextMonth = new Date(monthStart)
      nextMonth.setMonth(nextMonth.getMonth() + 1)
      const monthEnd = nextMonth.toISOString().split('T')[0]

      let storeQuery = supabase.from('stores').select('id, name, cluster_id, clusters(name)')
      if (selectedCluster) storeQuery = storeQuery.eq('cluster_id', selectedCluster)

      const { data: stores } = await storeQuery

      const { data: expenses } = await supabase
        .from('expenses')
        .select('store_id, amount, status')
        .gte('expense_month', monthStart)
        .lt('expense_month', monthEnd)

      const allExpenses = expenses ?? []
      const storeList = stores ?? []

      const rows: ReportRow[] = storeList.map((store) => {
        const storeExpenses = allExpenses.filter((e) => e.store_id === store.id)
        const total = storeExpenses.reduce((s, e) => s + Number(e.amount), 0)
        const approved = storeExpenses
          .filter((e) => ['accounting_approved', 'synced_to_tally'].includes(e.status))
          .reduce((s, e) => s + Number(e.amount), 0)
        const pending = storeExpenses
          .filter((e) => ['submitted', 'cluster_approved', 'draft'].includes(e.status))
          .reduce((s, e) => s + Number(e.amount), 0)
        const rejected = storeExpenses
          .filter((e) => e.status.includes('rejected'))
          .reduce((s, e) => s + Number(e.amount), 0)

        return {
          store: store.name,
          cluster: ((store.clusters as unknown) as { name: string } | null)?.name ?? '—',
          total_expenses: total,
          approved_amount: approved,
          pending_amount: pending,
          rejected_amount: rejected,
          expense_count: storeExpenses.length,
        }
      })

      setData(rows)
      setLoading(false)
    }
    fetchReport()
  }, [month, selectedCluster])

  if (!user || user.role !== 'accounting') {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">Reports are only accessible to Accounting users.</p>
      </div>
    )
  }

  const totals = data.reduce(
    (acc, row) => ({
      total: acc.total + row.total_expenses,
      approved: acc.approved + row.approved_amount,
      pending: acc.pending + row.pending_amount,
      rejected: acc.rejected + row.rejected_amount,
    }),
    { total: 0, approved: 0, pending: 0, rejected: 0 }
  )

  const handleExport = () => {
    const exportData = data.map((row) => ({
      Store: row.store,
      Cluster: row.cluster,
      'Month': format(new Date(`${month}-01`), 'MMMM yyyy'),
      'Total Expenses (₹)': row.total_expenses.toFixed(2),
      'Approved Amount (₹)': row.approved_amount.toFixed(2),
      'Pending Amount (₹)': row.pending_amount.toFixed(2),
      'Rejected Amount (₹)': row.rejected_amount.toFixed(2),
      'No. of Expenses': row.expense_count,
    }))
    exportCSV(exportData, `vscorp-petty-cash-${month}`)
  }

  const handleAddCash = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!topUpStore || !topUpAmount || Number(topUpAmount) <= 0) {
      setTopUpError('Please fill all fields correctly')
      return
    }

    setTopUpLoading(true)
    setTopUpError(null)
    setTopUpSuccess(false)

    try {
      const { error: insertError } = await supabase.from('cash_transactions').insert({
        store_id: topUpStore,
        created_by: user.id,
        type: 'credit',
        amount: Number(topUpAmount),
        remarks: topUpRemarks || 'Petty cash top-up',
      })

      if (insertError) throw insertError

      setTopUpSuccess(true)
      setTopUpStore('')
      setTopUpAmount('')
      setTopUpRemarks('')
      // Small delay before hiding success message
      setTimeout(() => setTopUpSuccess(false), 3000)
    } catch (err) {
      setTopUpError(err instanceof Error ? err.message : 'Failed to add cash')
    } finally {
      setTopUpLoading(false)
    }
  }

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Reports</h2>
          <p className="text-sm text-slate-500 mt-0.5">Monthly store-wise petty cash summary</p>
        </div>
        <Button onClick={handleExport} variant="outline">
          <Download size={15} />
          Export CSV
        </Button>
      </div>

      {/* Add Petty Cash Card */}
      <Card>
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-indigo-600" />
          <h3 className="font-semibold text-slate-800">Add Petty Cash</h3>
        </div>
        <form onSubmit={handleAddCash} className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Store</label>
              <select
                required
                value={topUpStore}
                onChange={(e) => setTopUpStore(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition-all"
              >
                <option value="">Select Store...</option>
                {allStores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Amount (₹)</label>
              <input
                required
                type="number"
                min="1"
                placeholder="0.00"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wider">Remarks</label>
              <input
                type="text"
                placeholder="Optional remarks..."
                value={topUpRemarks}
                onChange={(e) => setTopUpRemarks(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div className="flex items-end">
              <Button 
                type="submit" 
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all py-2"
                loading={topUpLoading}
              >
                <Plus className="w-4 h-4 mr-1" /> Add Cash
              </Button>
            </div>
          </div>
          
          {topUpError && (
            <p className="mt-3 text-xs text-red-500 font-medium flex items-center gap-1">
              <span className="w-1 h-1 bg-red-500 rounded-full" /> {topUpError}
            </p>
          )}
          {topUpSuccess && (
            <p className="mt-3 text-xs text-green-600 font-medium flex items-center gap-1">
              <Plus className="w-3 h-3" /> Cash added successfully to the store ledger.
            </p>
          )}
        </form>
      </Card>

      {/* Filters */}
      <Card>
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <BarChart3 size={15} className="text-slate-400" />

          <div>
            <label className="text-xs text-slate-500 mr-2">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500 mr-2">Cluster</label>
            <select
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">All Clusters</option>
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Summary totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Expenses', value: formatCurrency(totals.total), color: 'text-slate-800' },
          { label: 'Approved', value: formatCurrency(totals.approved), color: 'text-green-600' },
          { label: 'Pending', value: formatCurrency(totals.pending), color: 'text-amber-600' },
          { label: 'Rejected', value: formatCurrency(totals.rejected), color: 'text-red-500' },
        ].map((item) => (
          <Card key={item.label}>
            <div className="px-4 py-4">
              <p className="text-xs text-slate-500 font-medium">{item.label}</p>
              <p className={`text-xl font-bold mt-1 ${item.color}`}>{item.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="space-y-2 p-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Store</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Cluster</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Count</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Total</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Approved</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Pending</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.store} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-6 py-3 text-sm font-medium text-slate-700">{row.store}</td>
                    <td className="px-6 py-3 text-sm text-slate-500">{row.cluster}</td>
                    <td className="px-6 py-3 text-sm text-slate-500 text-right">{row.expense_count}</td>
                    <td className="px-6 py-3 text-sm font-semibold text-slate-700 text-right">
                      {formatCurrency(row.total_expenses)}
                    </td>
                    <td className="px-6 py-3 text-sm text-green-600 font-medium text-right">
                      {formatCurrency(row.approved_amount)}
                    </td>
                    <td className="px-6 py-3 text-sm text-amber-600 text-right">
                      {formatCurrency(row.pending_amount)}
                    </td>
                    <td className="px-6 py-3 text-sm text-red-500 text-right">
                      {formatCurrency(row.rejected_amount)}
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-400">
                      No data for this period
                    </td>
                  </tr>
                )}

                {/* Totals row */}
                {data.length > 0 && (
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td className="px-6 py-3 text-sm font-bold text-slate-800" colSpan={2}>
                      Total
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-slate-700 text-right">
                      {data.reduce((s, r) => s + r.expense_count, 0)}
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-slate-700 text-right">
                      {formatCurrency(totals.total)}
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-green-600 text-right">
                      {formatCurrency(totals.approved)}
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-amber-600 text-right">
                      {formatCurrency(totals.pending)}
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-red-500 text-right">
                      {formatCurrency(totals.rejected)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
