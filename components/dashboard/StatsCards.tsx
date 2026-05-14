'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { TrendingUp, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import type { User } from '@/types'

interface StatCardProps {
  title: string
  value: string
  subtitle?: string
  icon: React.ReactNode
  color: string
}

function StatCard({ title, value, subtitle, icon, color }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 py-5">
        <div className={`p-2.5 rounded-lg ${color}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-sm text-slate-500 font-medium">{title}</p>
          <p className="text-2xl font-bold text-slate-800 mt-0.5">{value}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

interface StoreManagerStatsProps {
  user: User
}

function StoreManagerStats({ user }: StoreManagerStatsProps) {
  const [stats, setStats] = useState({
    monthlySpend: 0,
    monthlyLimit: 10000,
    pendingCount: 0,
    approvedCount: 0,
  })
  const supabase = createClient()

  useEffect(() => {
    const fetchStats = async () => {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0]

      const [expensesRes, storeRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, status')
          .eq('store_id', user.store_id ?? '')
          .gte('expense_month', monthStart),
        supabase
          .from('stores')
          .select('monthly_limit')
          .eq('id', user.store_id ?? '')
          .single(),
      ])

      const expenses = expensesRes.data ?? []
      const excluded = ['draft', 'cluster_rejected', 'accounting_rejected']
      const totalSpend = expenses
        .filter((e) => !excluded.includes(e.status))
        .reduce((sum, e) => sum + Number(e.amount), 0)
      const pending = expenses.filter((e) => e.status === 'submitted').length
      const approved = expenses.filter((e) =>
        ['accounting_approved', 'synced_to_tally'].includes(e.status)
      ).length

      setStats({
        monthlySpend: totalSpend,
        monthlyLimit: storeRes.data?.monthly_limit ?? 10000,
        pendingCount: pending,
        approvedCount: approved,
      })
    }
    if (user.store_id) fetchStats()
  }, [user.store_id])

  const pct = Math.min(100, (stats.monthlySpend / stats.monthlyLimit) * 100)
  const overLimit = stats.monthlySpend > stats.monthlyLimit

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Monthly Spend"
          value={formatCurrency(stats.monthlySpend)}
          subtitle={`Limit: ${formatCurrency(stats.monthlyLimit)}`}
          icon={<TrendingUp size={18} className="text-indigo-600" />}
          color="bg-indigo-50"
        />
        <StatCard
          title="Pending Approval"
          value={String(stats.pendingCount)}
          subtitle="Awaiting cluster review"
          icon={<Clock size={18} className="text-amber-600" />}
          color="bg-amber-50"
        />
        <StatCard
          title="Approved This Month"
          value={String(stats.approvedCount)}
          subtitle="Fully approved expenses"
          icon={<CheckCircle size={18} className="text-green-600" />}
          color="bg-green-50"
        />
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Monthly Budget Usage</span>
            <span className={`text-sm font-semibold ${overLimit ? 'text-red-600' : 'text-slate-600'}`}>
              {pct.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-500 ${
                overLimit ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-indigo-600'
              }`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1.5">
            <span>{formatCurrency(stats.monthlySpend)} spent</span>
            <span>{formatCurrency(stats.monthlyLimit)} limit</span>
          </div>
          {overLimit && (
            <div className="flex items-center gap-1.5 mt-2 text-red-600 text-xs">
              <AlertTriangle size={12} />
              Over monthly limit — expenses can still be submitted for accounting review
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface ClusterManagerStatsProps {
  user: User
}

function ClusterManagerStats({ user }: ClusterManagerStatsProps) {
  const [data, setData] = useState<{ store: string; spend: number; pending: number }[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const supabase = createClient()

  useEffect(() => {
    const fetchStats = async () => {
      const { data: stores } = await supabase
        .from('stores')
        .select('id, name')
        .eq('cluster_id', user.cluster_id ?? '')

      if (!stores) return

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0]

      const storeIds = stores.map((s) => s.id)
      const { data: expenses } = await supabase
        .from('expenses')
        .select('store_id, amount, status')
        .in('store_id', storeIds)
        .gte('expense_month', monthStart)

      const pending = (expenses ?? []).filter((e) => e.status === 'submitted').length
      setPendingCount(pending)

      const storeMap = stores.map((store) => ({
        store: store.name,
        spend: (expenses ?? [])
          .filter((e) => e.store_id === store.id)
          .reduce((sum, e) => sum + Number(e.amount), 0),
        pending: (expenses ?? []).filter(
          (e) => e.store_id === store.id && e.status === 'submitted'
        ).length,
      }))
      setData(storeMap)
    }
    if (user.cluster_id) fetchStats()
  }, [user.cluster_id])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Pending Approvals"
          value={String(pendingCount)}
          subtitle="Expenses awaiting your review"
          icon={<Clock size={18} className="text-amber-600" />}
          color="bg-amber-50"
        />
        <StatCard
          title="Stores in Cluster"
          value={String(data.length)}
          subtitle="Active stores"
          icon={<TrendingUp size={18} className="text-indigo-600" />}
          color="bg-indigo-50"
        />
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Store-wise Spend This Month</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Store</th>
                <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Monthly Spend</th>
                <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Pending</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.store} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm text-slate-700 font-medium">{row.store}</td>
                  <td className="px-6 py-3 text-sm text-slate-600 text-right">{formatCurrency(row.spend)}</td>
                  <td className="px-6 py-3 text-right">
                    {row.pending > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        {row.pending}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-400">
                    No stores found in your cluster
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

interface AccountingStatsProps {
  user: User
}

function AccountingStats({ user: _user }: AccountingStatsProps) {
  const [stats, setStats] = useState({
    totalAmount: 0,
    submitted: 0,
    clusterApproved: 0,
    accountingApproved: 0,
  })
  const [storeBreakdown, setStoreBreakdown] = useState<
    { store: string; total: number; approved: number; pending: number }[]
  >([])
  const supabase = createClient()

  useEffect(() => {
    const fetchStats = async () => {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0]

      const { data: expenses } = await supabase
        .from('expenses')
        .select('amount, status, store_id, store:stores(name)')
        .gte('expense_month', monthStart)

      const all = expenses ?? []
      const totalAmount = all.reduce((s, e) => s + Number(e.amount), 0)
      const submitted = all.filter((e) => e.status === 'submitted').length
      const clusterApproved = all.filter((e) => e.status === 'cluster_approved').length
      const accountingApproved = all.filter((e) =>
        ['accounting_approved', 'synced_to_tally'].includes(e.status)
      ).length

      setStats({ totalAmount, submitted, clusterApproved, accountingApproved })

      // Store breakdown
      const storeMap: Record<string, { store: string; total: number; approved: number; pending: number }> = {}
      for (const e of all) {
        const storeName = ((e.store as unknown) as { name: string } | null)?.name ?? e.store_id
        if (!storeMap[e.store_id]) {
          storeMap[e.store_id] = { store: storeName, total: 0, approved: 0, pending: 0 }
        }
        storeMap[e.store_id].total += Number(e.amount)
        if (['accounting_approved', 'synced_to_tally'].includes(e.status)) {
          storeMap[e.store_id].approved += Number(e.amount)
        }
        if (['submitted', 'cluster_approved'].includes(e.status)) {
          storeMap[e.store_id].pending += Number(e.amount)
        }
      }
      setStoreBreakdown(Object.values(storeMap))
    }
    fetchStats()
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total This Month"
          value={formatCurrency(stats.totalAmount)}
          icon={<TrendingUp size={18} className="text-indigo-600" />}
          color="bg-indigo-50"
        />
        <StatCard
          title="Awaiting Cluster"
          value={String(stats.submitted)}
          icon={<Clock size={18} className="text-amber-600" />}
          color="bg-amber-50"
        />
        <StatCard
          title="Awaiting Accounting"
          value={String(stats.clusterApproved)}
          icon={<AlertTriangle size={18} className="text-orange-600" />}
          color="bg-orange-50"
        />
        <StatCard
          title="Fully Approved"
          value={String(stats.accountingApproved)}
          icon={<CheckCircle size={18} className="text-green-600" />}
          color="bg-green-50"
        />
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Store-wise Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-6 py-3">Store</th>
                <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Total</th>
                <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Approved</th>
                <th className="text-right text-xs font-medium text-slate-500 px-6 py-3">Pending</th>
              </tr>
            </thead>
            <tbody>
              {storeBreakdown.map((row) => (
                <tr key={row.store} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm text-slate-700 font-medium">{row.store}</td>
                  <td className="px-6 py-3 text-sm text-slate-600 text-right">{formatCurrency(row.total)}</td>
                  <td className="px-6 py-3 text-sm text-green-600 font-medium text-right">{formatCurrency(row.approved)}</td>
                  <td className="px-6 py-3 text-sm text-amber-600 text-right">{formatCurrency(row.pending)}</td>
                </tr>
              ))}
              {storeBreakdown.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-400">
                    No expense data for this month
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export { StoreManagerStats, ClusterManagerStats, AccountingStats }
