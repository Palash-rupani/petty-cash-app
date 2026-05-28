'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, compactCurrency } from '@/lib/utils/formatCurrency'
import { normalizeExpenseStatus } from '@/types'
import {
  Download, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, Loader2, TrendingUp, TrendingDown,
  ShieldAlert, DollarSign, Clock, Store, Building2, BarChart2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, AreaChart, Area,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountingExpense {
  id:            string
  amount:        number
  status:        string
  description:   string | null
  expense_month: string
  created_at:    string
  store: {
    id:           string
    name:         string
    cluster_id:   string
    cluster_name: string
  } | null
  category:    { id: string; name: string } | null
  creator:     { id: string; name: string } | null
  approver_name: string | null
}

interface StoreSummaryRow {
  storeId:     string
  storeName:   string
  clusterId:   string
  clusterName: string
  thisMonth:   number
  lastMonth:   number
  diff:        number
  count:       number
}

interface ClusterSummaryRow {
  clusterId:   string
  clusterName: string
  total:       number
  storeCount:  number
  avgPerStore: number
}

interface Stats {
  thisMonthTotal:         number
  lastMonthTotal:         number
  pendingCount:           number
  highestSpendingStore:   { name: string; amount: number } | null
  highestSpendingCluster: { name: string; amount: number } | null
  storeSummary:           StoreSummaryRow[]
  clusterSummary:         ClusterSummaryRow[]
  monthlyTrend:           { month: string; amount: number }[]
  categoryBreakdown:      { name: string; amount: number }[]
  statusDistribution:     Record<string, number>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMonthBounds(year: number, month: number) {
  const from    = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to      = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function formatMonth(isoDate: string): string {
  if (!isoDate) return '—'
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

function formatDate(isoDate: string): string {
  if (!isoDate) return '—'
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusLabel(raw: string): string {
  const norm = normalizeExpenseStatus(raw as never)
  const labels: Record<string, string> = {
    draft:     'Draft',
    submitted: 'Pending',
    approved:  'Approved',
    rejected:  'Rejected',
  }
  return labels[norm] ?? raw
}

function statusClasses(raw: string): string {
  const norm = normalizeExpenseStatus(raw as never)
  const map: Record<string, string> = {
    draft:     'bg-slate-100 text-slate-600 border-slate-200',
    submitted: 'bg-amber-50  text-amber-700  border-amber-200',
    approved:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected:  'bg-red-50    text-red-700    border-red-200',
  }
  return map[norm] ?? 'bg-slate-100 text-slate-600 border-slate-200'
}

function diffColor(diff: number): string {
  if (diff > 0)  return 'text-red-600'    // higher spend = bad
  if (diff < 0)  return 'text-emerald-600'
  return 'text-slate-400'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  icon, bg, label, value, sub, subColor = 'text-slate-400',
}: {
  icon:       React.ReactNode
  bg:         string
  label:      string
  value:      string
  sub?:       string
  subColor?:  string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] leading-snug">{label}</p>
        <div className={`p-2 rounded-xl ${bg} flex-shrink-0`}>{icon}</div>
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
        {sub && <p className={`text-xs mt-1.5 font-medium leading-snug ${subColor}`}>{sub}</p>}
      </div>
    </div>
  )
}

function SortHeader({
  col, label, currentCol, dir, onSort, className = '',
}: {
  col:        string
  label:      string
  currentCol: string
  dir:        'asc' | 'desc'
  onSort:     (col: string) => void
  className?: string
}) {
  const active = col === currentCol
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap ${className}`}
      onClick={() => onSort(col)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        {active ? (
          dir === 'asc'
            ? <ChevronUp size={13} className="text-indigo-500" />
            : <ChevronDown size={13} className="text-indigo-500" />
        ) : (
          <ChevronsUpDown size={13} className="text-slate-300" />
        )}
      </div>
    </th>
  )
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <tr key={i} className="animate-pulse">
          {[...Array(cols)].map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-slate-100 rounded" style={{ width: `${60 + (j * 17) % 30}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

const currencyFmt = (v: number | string) => formatCurrency(typeof v === 'number' ? v : Number(v))

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const { user, loading: authLoading } = useAuth()
  const supabase = createClient()

  // ── Filter state ──────────────────────────────────────────────────────────
  const [datePreset, setDatePreset]     = useState<'this_month' | 'last_month' | 'all_time' | 'custom'>('all_time')
  const [dateFrom,   setDateFrom]       = useState('')
  const [dateTo,     setDateTo]         = useState('')
  const [storeFilter,    setStoreFilter]    = useState('')
  const [clusterFilter,  setClusterFilter]  = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter,   setStatusFilter]   = useState('')

  // ── Sort + pagination state ───────────────────────────────────────────────
  const [sortCol, setSortCol] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page,    setPage]    = useState(1)
  const PAGE_SIZE = 25

  // ── Data state ────────────────────────────────────────────────────────────
  const [expenses,       setExpenses]       = useState<AccountingExpense[]>([])
  const [totalCount,     setTotalCount]     = useState(0)
  const [expensesLoading, setExpensesLoading] = useState(false)

  const [stats,        setStats]        = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // ── Dropdown data ─────────────────────────────────────────────────────────
  const [stores,     setStores]     = useState<{ id: string; name: string }[]>([])
  const [clusters,   setClusters]   = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  // ── Export state ──────────────────────────────────────────────────────────
  const [exportLoading, setExportLoading] = useState(false)

  // ── Load dropdown data once (small metadata — fetched direct from Supabase) ─
  useEffect(() => {
    if (!user || user.role !== 'accounting') return
    const load = async () => {
      const [storesRes, clustersRes, catsRes] = await Promise.all([
        supabase.from('stores').select('id, name').order('name'),
        supabase.from('clusters').select('id, name').order('name'),
        supabase.from('categories').select('id, name').order('name'),
      ])
      if (!storesRes.error)   setStores(storesRes.data ?? [])
      if (!clustersRes.error) setClusters(clustersRes.data ?? [])
      if (!catsRes.error)     setCategories(catsRes.data ?? [])
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // ── Fetch stats (always this month vs last month, no date filter) ─────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const p = new URLSearchParams()
      if (storeFilter)    p.set('store_id',    storeFilter)
      if (clusterFilter)  p.set('cluster_id',  clusterFilter)
      if (categoryFilter) p.set('category_id', categoryFilter)
      if (statusFilter)   p.set('status',      statusFilter)
      const res = await fetch(`/api/accounting/stats?${p}`)
      if (!res.ok) return
      setStats(await res.json())
    } finally {
      setStatsLoading(false)
    }
  }, [storeFilter, clusterFilter, categoryFilter, statusFilter])

  // ── Fetch expenses (filtered + paginated) ─────────────────────────────────
  const fetchExpenses = useCallback(async () => {
    setExpensesLoading(true)
    try {
      const p = new URLSearchParams()
      p.set('page',      String(page))
      p.set('page_size', String(PAGE_SIZE))
      p.set('sort_col',  sortCol)
      p.set('sort_dir',  sortDir)
      if (storeFilter)    p.set('store_id',    storeFilter)
      if (clusterFilter)  p.set('cluster_id',  clusterFilter)
      if (categoryFilter) p.set('category_id', categoryFilter)
      if (statusFilter)   p.set('status',      statusFilter)
      if (dateFrom)       p.set('date_from',   dateFrom)
      if (dateTo)         p.set('date_to',     dateTo)
      const res = await fetch(`/api/accounting/expenses?${p}`)
      if (!res.ok) return
      const json = await res.json()
      setExpenses(json.data ?? [])
      setTotalCount(json.count ?? 0)
    } finally {
      setExpensesLoading(false)
    }
  }, [page, PAGE_SIZE, sortCol, sortDir, storeFilter, clusterFilter, categoryFilter, statusFilter, dateFrom, dateTo])

  // Trigger stats on filter change (not date/sort/page)
  useEffect(() => {
    if (!user || user.role !== 'accounting') return
    fetchStats()
  }, [user, fetchStats])

  // Trigger expenses on any filter/sort/page change
  useEffect(() => {
    if (!user || user.role !== 'accounting') return
    fetchExpenses()
  }, [user, fetchExpenses])

  // ── Date preset handler ───────────────────────────────────────────────────
  const handleDatePreset = (preset: 'this_month' | 'last_month' | 'all_time' | 'custom') => {
    setDatePreset(preset)
    setPage(1)
    const now = new Date()
    if (preset === 'this_month') {
      const b = getMonthBounds(now.getFullYear(), now.getMonth() + 1)
      setDateFrom(b.from)
      setDateTo(b.to)
    } else if (preset === 'last_month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const b  = getMonthBounds(lm.getFullYear(), lm.getMonth() + 1)
      setDateFrom(b.from)
      setDateTo(b.to)
    } else if (preset === 'all_time') {
      setDateFrom('')
      setDateTo('')
    }
  }

  // ── Sort handler ──────────────────────────────────────────────────────────
  const handleSort = (col: string) => {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  // ── Filter change helpers ─────────────────────────────────────────────────
  const changeFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v)
    setPage(1)
  }

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (exportLoading) return
    setExportLoading(true)
    try {
      const p = new URLSearchParams()
      p.set('export', 'true')
      if (storeFilter)    p.set('store_id',    storeFilter)
      if (clusterFilter)  p.set('cluster_id',  clusterFilter)
      if (categoryFilter) p.set('category_id', categoryFilter)
      if (statusFilter)   p.set('status',      statusFilter)
      if (dateFrom)       p.set('date_from',   dateFrom)
      if (dateTo)         p.set('date_to',     dateTo)

      const res = await fetch(`/api/accounting/expenses?${p}`)
      if (!res.ok) return
      const json = await res.json()
      const rows: AccountingExpense[] = json.data ?? []

      const headers = [
        'Expense Month', 'Store', 'Cluster', 'Category', 'Amount (INR)',
        'Status', 'Description', 'Created By', 'Approved By', 'Created At',
      ]
      const csvRows = rows.map(e => [
        formatMonth(e.expense_month),
        e.store?.name         ?? '',
        e.store?.cluster_name ?? '',
        e.category?.name      ?? '',
        e.amount,
        statusLabel(e.status),
        (e.description ?? '').replace(/"/g, '""'),
        e.creator?.name       ?? '',
        e.approver_name       ?? '',
        formatDate(e.created_at),
      ])

      const csvContent = [headers, ...csvRows]
        .map(row => row.map(v => `"${v}"`).join(','))
        .join('\n')

      const now      = new Date()
      const month    = now.toLocaleString('en-IN', { month: 'long' }).toLowerCase()
      const year     = now.getFullYear()
      const filename = `petty_cash_report_${month}_${year}.csv`

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setExportLoading(false)
    }
  }

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse max-w-screen-2xl mx-auto">
        <div className="h-9 w-72 bg-slate-100 rounded-xl" />
        <div className="h-14 bg-slate-100 rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-slate-100 rounded-xl" />)}
        </div>
        <div className="h-80 bg-slate-100 rounded-xl" />
      </div>
    )
  }

  if (!user || user.role !== 'accounting') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-slate-400">
        <ShieldAlert className="w-16 h-16 text-slate-200" />
        <h2 className="text-xl font-bold text-slate-600">Accounting Access Required</h2>
        <p className="text-sm text-slate-500">This dashboard is restricted to the Accounting team.</p>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const totalPages  = Math.ceil(totalCount / PAGE_SIZE)
  const showFrom    = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showTo      = Math.min(page * PAGE_SIZE, totalCount)

  const monthDiff   = stats ? stats.thisMonthTotal - stats.lastMonthTotal : 0
  const monthDiffPct = stats && stats.lastMonthTotal > 0
    ? Math.round((monthDiff / stats.lastMonthTotal) * 100)
    : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-screen-2xl mx-auto space-y-6">

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.2em] mb-0.5">
            Accounting · Read-Only Oversight
          </p>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Finance Reports</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">
            Monitor, analyse, and export petty cash expenses across all stores and clusters.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportLoading || totalCount === 0}
          className="flex items-center gap-2 h-10 px-4 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {exportLoading
            ? <Loader2 size={15} className="animate-spin" />
            : <Download size={15} />}
          Export CSV
        </button>
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        {/* Date presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-1">Date</span>
          {([
            { key: 'all_time',   label: 'All Time' },
            { key: 'this_month', label: 'This Month' },
            { key: 'last_month', label: 'Last Month' },
            { key: 'custom',     label: 'Custom Range' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleDatePreset(key)}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors ${
                datePreset === key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                className="h-8 px-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1) }}
                className="h-8 px-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Dropdown filters */}
        <div className="flex flex-wrap gap-2">
          {/* Store */}
          <select
            value={storeFilter}
            onChange={e => changeFilter(setStoreFilter)(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-w-[150px]"
          >
            <option value="">All Stores</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Cluster */}
          <select
            value={clusterFilter}
            onChange={e => changeFilter(setClusterFilter)(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-w-[150px]"
          >
            <option value="">All Clusters</option>
            {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Category */}
          <select
            value={categoryFilter}
            onChange={e => changeFilter(setCategoryFilter)(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-w-[150px]"
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={e => changeFilter(setStatusFilter)(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-w-[140px]"
          >
            <option value="">All Statuses</option>
            <option value="submitted">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="draft">Draft</option>
          </select>

          {/* Clear button */}
          {(storeFilter || clusterFilter || categoryFilter || statusFilter || dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setStoreFilter('')
                setClusterFilter('')
                setCategoryFilter('')
                setStatusFilter('')
                handleDatePreset('all_time')
              }}
              className="h-9 px-3 text-sm font-medium text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {statsLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))
        ) : (
          <>
            <SummaryCard
              icon={<DollarSign size={16} className="text-indigo-600" />}
              bg="bg-indigo-50"
              label="This Month Total"
              value={compactCurrency(stats?.thisMonthTotal ?? 0)}
              sub={
                monthDiffPct !== null
                  ? `${monthDiffPct >= 0 ? '+' : ''}${monthDiffPct}% vs last month`
                  : 'vs last month'
              }
              subColor={monthDiff > 0 ? 'text-red-500' : monthDiff < 0 ? 'text-emerald-600' : 'text-slate-400'}
            />
            <SummaryCard
              icon={<BarChart2 size={16} className="text-slate-600" />}
              bg="bg-slate-100"
              label="Last Month Total"
              value={compactCurrency(stats?.lastMonthTotal ?? 0)}
            />
            <SummaryCard
              icon={<Clock size={16} className="text-amber-600" />}
              bg="bg-amber-50"
              label="Pending Expenses"
              value={String(stats?.pendingCount ?? 0)}
              sub="Awaiting approval"
              subColor={(stats?.pendingCount ?? 0) > 0 ? 'text-amber-600' : 'text-slate-400'}
            />
            <SummaryCard
              icon={<Store size={16} className="text-emerald-600" />}
              bg="bg-emerald-50"
              label="Top Store (This Month)"
              value={stats?.highestSpendingStore ? compactCurrency(stats.highestSpendingStore.amount) : '—'}
              sub={stats?.highestSpendingStore?.name ?? 'No data'}
            />
            <SummaryCard
              icon={<Building2 size={16} className="text-purple-600" />}
              bg="bg-purple-50"
              label="Top Cluster (This Month)"
              value={stats?.highestSpendingCluster ? compactCurrency(stats.highestSpendingCluster.amount) : '—'}
              sub={stats?.highestSpendingCluster?.name ?? 'No data'}
            />
          </>
        )}
      </div>

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      {!statsLoading && stats && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Monthly Trend */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <p className="text-sm font-bold text-slate-800 mb-0.5">Monthly Expense Trend</p>
            <p className="text-xs text-slate-400 mb-4">Last 6 months — all expenses</p>
            {stats.monthlyTrend.every(d => d.amount === 0) ? (
              <div className="flex items-center justify-center h-48 text-slate-300 text-sm font-medium">
                No expense data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={stats.monthlyTrend} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }} tickLine={false} axisLine={false} dy={6} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={42} />
                  <Tooltip formatter={currencyFmt as never}
                    contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0/0.1)' }} />
                  <Area type="monotone" dataKey="amount" name="Total Spend" stroke="#4f46e5" strokeWidth={2.5}
                    fill="url(#trendGrad)" activeDot={{ r: 5, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category Breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <p className="text-sm font-bold text-slate-800 mb-0.5">Top Categories This Month</p>
            <p className="text-xs text-slate-400 mb-4">Expense allocation by category</p>
            {stats.categoryBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-300 text-sm font-medium">
                No category data for this month
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.categoryBreakdown} layout="vertical" barSize={12}
                  margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name"
                    tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} width={120}
                    tickLine={false} axisLine={false} />
                  <Tooltip formatter={currencyFmt as never}
                    contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0/0.1)' }}
                    cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="amount" name="Amount" radius={[0, 4, 4, 0]}>
                    {stats.categoryBreakdown.map((_, i) => (
                      <Cell key={i} fill={`hsl(245, ${75 - i * 5}%, ${58 + i * 3}%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Main Expense Table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <p className="text-sm font-bold text-slate-800">All Expenses</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {expensesLoading ? 'Loading…' : `Showing ${showFrom}–${showTo} of ${totalCount.toLocaleString('en-IN')} expenses`}
            </p>
          </div>
          {expensesLoading && <Loader2 size={16} className="animate-spin text-slate-400 flex-shrink-0" />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <SortHeader col="expense_month" label="Month"      currentCol={sortCol} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Store</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Cluster</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Category</th>
                <SortHeader col="amount"  label="Amount"  currentCol={sortCol} dir={sortDir} onSort={handleSort} />
                <SortHeader col="status"  label="Status"  currentCol={sortCol} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Created By</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Approved By</th>
                <SortHeader col="created_at" label="Created At" currentCol={sortCol} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expensesLoading ? (
                <TableSkeleton cols={10} />
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-sm text-slate-400 font-medium">
                    No expenses found for the selected filters.
                  </td>
                </tr>
              ) : (
                expenses.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50/60 transition-colors bg-white">
                    <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                      {formatMonth(e.expense_month)}
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium whitespace-nowrap">
                      {e.store?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {e.store?.cluster_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {e.category?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(e.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${statusClasses(e.status)}`}>
                        {statusLabel(e.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">
                      {e.description || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {e.creator?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {e.approver_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {formatDate(e.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/30">
            <p className="text-xs text-slate-500 font-medium">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || expensesLoading}
                className="flex items-center gap-1 h-8 px-3 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || expensesLoading}
                className="flex items-center gap-1 h-8 px-3 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Store-Wise Summary ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <p className="text-sm font-bold text-slate-800">Store-Wise Summary</p>
          <p className="text-xs text-slate-400 mt-0.5">
            This month vs last month — sorted by highest spend
          </p>
        </div>

        {statsLoading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg" />)}
          </div>
        ) : !stats || stats.storeSummary.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400 font-medium">
            No store data available.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  {['Store Name', 'Cluster', 'This Month', 'Last Month', 'Difference', 'Expense Count'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.storeSummary.map(row => (
                  <tr key={row.storeId} className="hover:bg-slate-50/60 bg-white transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.storeName}</td>
                    <td className="px-4 py-3 text-slate-500">{row.clusterName}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(row.thisMonth)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">
                      {formatCurrency(row.lastMonth)}
                    </td>
                    <td className={`px-4 py-3 font-semibold tabular-nums whitespace-nowrap ${diffColor(row.diff)}`}>
                      <span className="flex items-center gap-1">
                        {row.diff > 0 ? <TrendingUp size={13} /> : row.diff < 0 ? <TrendingDown size={13} /> : null}
                        {row.diff >= 0 ? '+' : ''}{formatCurrency(row.diff)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Cluster Comparison ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <p className="text-sm font-bold text-slate-800">Cluster Comparison</p>
          <p className="text-xs text-slate-400 mt-0.5">
            This month — sorted by highest total
          </p>
        </div>

        {statsLoading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg" />)}
          </div>
        ) : !stats || stats.clusterSummary.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400 font-medium">
            No cluster data available.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white border-b border-slate-200">
                  {['Cluster Name', 'Total Expenses', 'No. of Stores', 'Avg per Store'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.clusterSummary.map(row => (
                  <tr key={row.clusterId} className="hover:bg-slate-50/60 bg-white transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-800">{row.clusterName}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(row.total)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">{row.storeCount}</td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">
                      {formatCurrency(row.avgPerStore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
