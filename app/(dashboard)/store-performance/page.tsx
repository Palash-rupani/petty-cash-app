'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, compactCurrency } from '@/lib/utils/formatCurrency'
import { cn } from '@/lib/utils/cn'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Minus, ShieldAlert,
  IndianRupee, Receipt, Package, BarChart2,
  Building2, ChevronUp, ChevronDown, X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StorePerfRow {
  storeId:            string
  storeName:          string
  clusterId:          string
  clusterName:        string
  revenue:            number
  bills:              number
  units:              number
  avgBillValue:       number
  revenueLastPeriod:  number
  growth:             number | null
}

interface ClusterPerfRow {
  clusterId:    string
  clusterName:  string
  revenue:      number
  bills:        number
  avgBillValue: number
  storeCount:   number
}

interface DailyPoint { date: string; revenue: number }
interface ProductRow  { barcode: string; revenue: number; qty: number }

interface PerfData {
  totals:         { revenue: number; bills: number; units: number; avgBillValue: number }
  storeSummary:   StorePerfRow[]
  clusterSummary: ClusterPerfRow[]
  dailyTrend:     DailyPoint[]
  topProducts:    ProductRow[]
}

interface DropdownStore   { id: string; name: string; cluster_id: string }
interface DropdownCluster { id: string; name: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

type DatePreset = 'this_month' | 'last_month' | 'custom'

function getMonthBounds(preset: Exclude<DatePreset, 'custom'>): { from: string; to: string } {
  const now  = new Date()
  const pad  = (n: number) => String(n).padStart(2, '0')

  if (preset === 'this_month') {
    const y   = now.getFullYear()
    const m   = now.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
  }
  // last_month
  const lm   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const y    = lm.getFullYear()
  const m    = lm.getMonth() + 1
  const last = new Date(y, m, 0).getDate()
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
}

function formatDateLabel(dateStr: string): string {
  // "2025-05-01" → "May '25"
  const [y, mo] = dateStr.split('-')
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-IN', {
    month: 'short', year: '2-digit',
  })
}

function formatDayLabel(dateStr: string): string {
  // "2025-05-15" → "15 May"
  const [, mo, dd] = dateStr.split('-')
  return `${Number(dd)} ${new Date(2000, Number(mo) - 1).toLocaleDateString('en-IN', { month: 'short' })}`
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n)
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface KpiCardProps {
  label:    string
  value:    string
  sub?:     string
  icon:     React.ReactNode
  color:    string
  loading?: boolean
}

function KpiCard({ label, value, sub, icon, color, loading }: KpiCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-28 bg-slate-200 rounded" />
          <div className="w-9 h-9 bg-slate-200 rounded-lg" />
        </div>
        <div className="h-8 w-36 bg-slate-200 rounded mb-1" />
        <div className="h-3 w-20 bg-slate-100 rounded" />
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', color)}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800 leading-none">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  )
}

type SortDir = 'asc' | 'desc'

interface SortHeaderProps {
  col:     string
  label:   string
  active:  string
  dir:     SortDir
  onSort:  (col: string) => void
  align?:  'left' | 'right'
}

function SortHeader({ col, label, active, dir, onSort, align = 'left' }: SortHeaderProps) {
  const isActive = active === col
  return (
    <th
      onClick={() => onSort(col)}
      className={cn(
        'px-4 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors',
        isActive ? 'text-indigo-700 bg-indigo-50' : 'text-slate-500 hover:text-slate-700',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive
          ? dir === 'asc'
            ? <ChevronUp size={12} />
            : <ChevronDown size={12} />
          : <ChevronDown size={12} className="opacity-30" />}
      </span>
    </th>
  )
}

function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, ri) => (
        <tr key={ri} className="border-b border-slate-100">
          {Array.from({ length: cols }).map((_, ci) => (
            <td key={ci} className="px-4 py-3">
              <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: ci === 1 ? '60%' : '80%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ── Growth badge ──────────────────────────────────────────────────────────────

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-400 text-xs">—</span>
  if (pct > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600">
      <TrendingUp size={12} /> {pct.toFixed(1)}%
    </span>
  )
  if (pct < 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-500">
      <TrendingDown size={12} /> {Math.abs(pct).toFixed(1)}%
    </span>
  )
  return <span className="inline-flex items-center gap-0.5 text-xs text-slate-400"><Minus size={12} /> 0%</span>
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function StorePerformancePage() {
  const { user, loading: authLoading } = useAuth()

  // ── Filter state ──────────────────────────────────────────────────────────
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month')
  const [dateFrom,   setDateFrom]   = useState<string>(() => getMonthBounds('this_month').from)
  const [dateTo,     setDateTo]     = useState<string>(() => getMonthBounds('this_month').to)
  const [storeFilter,   setStoreFilter]   = useState('')
  const [clusterFilter, setClusterFilter] = useState('')

  // ── Sort state (store table) ──────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<string>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // ── Detail selection ──────────────────────────────────────────────────────
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)

  // ── Data state ────────────────────────────────────────────────────────────
  const [data,    setData]    = useState<PerfData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // ── Dropdown metadata ─────────────────────────────────────────────────────
  const [stores,   setStores]   = useState<DropdownStore[]>([])
  const [clusters, setClusters] = useState<DropdownCluster[]>([])

  // ── Load dropdown data once ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    const sb = createClient()
    Promise.all([
      sb.from('stores').select('id, name, cluster_id').order('name'),
      sb.from('clusters').select('id, name').order('name'),
    ]).then(([sRes, cRes]) => {
      setStores((sRes.data ?? []) as DropdownStore[])
      setClusters((cRes.data ?? []) as DropdownCluster[])
    })
  }, [user])

  // ── Fetch performance data ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
      if (storeFilter)   params.set('store_id',   storeFilter)
      if (clusterFilter) params.set('cluster_id', clusterFilter)
      const res = await fetch(`/api/store-performance?${params}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load data'); return }
      setData(json as PerfData)
      // Auto-clear selected store if it's no longer in results
      if (selectedStoreId && !(json as PerfData).storeSummary.find(r => r.storeId === selectedStoreId)) {
        setSelectedStoreId(null)
      }
    } catch {
      setError('Network error — could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [user, dateFrom, dateTo, storeFilter, clusterFilter])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Date preset handler ───────────────────────────────────────────────────
  function handlePreset(preset: DatePreset) {
    setDatePreset(preset)
    if (preset !== 'custom') {
      const { from, to } = getMonthBounds(preset)
      setDateFrom(from)
      setDateTo(to)
    }
  }

  // ── Sort handler ──────────────────────────────────────────────────────────
  function handleSort(col: string) {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  // ── Clear filters ─────────────────────────────────────────────────────────
  function clearFilters() {
    setDatePreset('this_month')
    const { from, to } = getMonthBounds('this_month')
    setDateFrom(from)
    setDateTo(to)
    setStoreFilter('')
    setClusterFilter('')
    setSelectedStoreId(null)
  }

  // ── Derived: sorted store rows ────────────────────────────────────────────
  const sortedStores = [...(data?.storeSummary ?? [])].sort((a, b) => {
    const av = a[sortCol as keyof StorePerfRow] as number ?? 0
    const bv = b[sortCol as keyof StorePerfRow] as number ?? 0
    return sortDir === 'asc' ? av - bv : bv - av
  })

  // ── Detail store row ──────────────────────────────────────────────────────
  const detailStore = selectedStoreId
    ? data?.storeSummary.find(r => r.storeId === selectedStoreId) ?? null
    : null

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!user || !['admin', 'accounting', 'cluster_manager'].includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
        <ShieldAlert size={36} className="text-red-400" />
        <p className="text-sm font-medium">Access restricted</p>
      </div>
    )
  }

  const hasFilters = storeFilter || clusterFilter || datePreset !== 'this_month'
  const chartColors = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6','#f97316','#84cc16']

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-screen-2xl">

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Store Performance</h1>
        <p className="text-sm text-slate-500 mt-1">
          Sales revenue, bills, and unit trends across stores and clusters.
        </p>
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">

          {/* Date presets */}
          <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-1">
            {(['this_month', 'last_month', 'custom'] as DatePreset[]).map(p => (
              <button
                key={p}
                onClick={() => handlePreset(p)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                  datePreset === p
                    ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {p === 'this_month' ? 'This Month' : p === 'last_month' ? 'Last Month' : 'Custom'}
              </button>
            ))}
          </div>

          {/* Custom date pickers */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 px-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 px-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
          )}

          {/* Cluster filter (hidden for cluster_manager — they're always scoped) */}
          {user.role !== 'cluster_manager' && (
            <select
              value={clusterFilter}
              onChange={e => { setClusterFilter(e.target.value); setStoreFilter(''); setSelectedStoreId(null) }}
              className="h-9 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="">All Clusters</option>
              {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}

          {/* Store filter */}
          <select
            value={storeFilter}
            onChange={e => { setStoreFilter(e.target.value); setSelectedStoreId(null) }}
            className="h-9 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          >
            <option value="">All Stores</option>
            {(clusterFilter
              ? stores.filter(s => s.cluster_id === clusterFilter)
              : stores
            ).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Clear */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* Period label */}
        <p className="text-xs text-slate-400 mt-2">
          Period: <span className="font-medium text-slate-600">{dateFrom}</span>
          {' '}&rarr;{' '}
          <span className="font-medium text-slate-600">{dateTo}</span>
        </p>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Revenue"
          value={loading ? '—' : compactCurrency(data?.totals.revenue ?? 0)}
          sub={loading ? '' : `${formatCurrency(data?.totals.revenue ?? 0)}`}
          icon={<IndianRupee size={16} className="text-indigo-600" />}
          color="bg-indigo-50"
          loading={loading}
        />
        <KpiCard
          label="Total Bills"
          value={loading ? '—' : formatNumber(data?.totals.bills ?? 0)}
          sub="Distinct bill numbers"
          icon={<Receipt size={16} className="text-emerald-600" />}
          color="bg-emerald-50"
          loading={loading}
        />
        <KpiCard
          label="Units Sold"
          value={loading ? '—' : formatNumber(data?.totals.units ?? 0)}
          sub="Total quantity"
          icon={<Package size={16} className="text-violet-600" />}
          color="bg-violet-50"
          loading={loading}
        />
        <KpiCard
          label="Avg Bill Value"
          value={loading ? '—' : formatCurrency(data?.totals.avgBillValue ?? 0)}
          sub="Revenue ÷ Bills"
          icon={<BarChart2 size={16} className="text-amber-600" />}
          color="bg-amber-50"
          loading={loading}
        />
      </div>

      {/* ── Store Detail Panel ────────────────────────────────────────────── */}
      {detailStore && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 relative">
          <button
            onClick={() => setSelectedStoreId(null)}
            className="absolute top-3 right-3 p-1 rounded-md text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            <X size={15} />
          </button>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-indigo-600" />
            <h2 className="text-sm font-semibold text-indigo-800">{detailStore.storeName}</h2>
            <span className="text-xs text-indigo-500 bg-indigo-100 px-2 py-0.5 rounded-full">
              {detailStore.clusterName}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              {
                label: 'Revenue (Period)',
                value: compactCurrency(detailStore.revenue),
                sub:   formatCurrency(detailStore.revenue),
              },
              {
                label: 'Revenue (Prev Period)',
                value: detailStore.revenueLastPeriod > 0 ? compactCurrency(detailStore.revenueLastPeriod) : '—',
                sub:   detailStore.revenueLastPeriod > 0 ? formatCurrency(detailStore.revenueLastPeriod) : 'No prior data',
              },
              {
                label: 'Growth',
                value: detailStore.growth !== null ? `${detailStore.growth > 0 ? '+' : ''}${detailStore.growth}%` : '—',
                sub:   detailStore.growth !== null
                  ? detailStore.growth > 0 ? '↑ vs prior period' : detailStore.growth < 0 ? '↓ vs prior period' : 'Flat'
                  : 'No comparison data',
                accent: detailStore.growth !== null
                  ? detailStore.growth > 0 ? 'text-emerald-700'
                  : detailStore.growth < 0 ? 'text-red-600'
                  : 'text-slate-500'
                  : 'text-slate-400',
              },
              {
                label: 'Bills',
                value: formatNumber(detailStore.bills),
                sub:   'Distinct bills',
              },
              {
                label: 'Units Sold',
                value: formatNumber(detailStore.units),
                sub:   'Total qty',
              },
              {
                label: 'Avg Bill Value',
                value: formatCurrency(detailStore.avgBillValue),
                sub:   'Revenue ÷ Bills',
              },
            ].map(({ label, value, sub, accent }) => (
              <div key={label} className="bg-white rounded-lg px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-400 font-medium mb-1">{label}</p>
                <p className={cn('text-base font-bold text-slate-800', accent)}>{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      {!loading && data && (data.dailyTrend.length > 0 || data.topProducts.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

          {/* Daily Revenue Trend */}
          <div className="xl:col-span-3 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Daily Revenue Trend</h2>
            {data.dailyTrend.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.dailyTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDayLabel}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={v => compactCurrency(v)}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [formatCurrency(Number(v)), 'Revenue']}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    labelFormatter={(l: any) => formatDayLabel(String(l))}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#revGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top 10 Products */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Top 10 Products by Revenue</h2>
            {data.topProducts.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.topProducts}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={v => compactCurrency(v)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="barcode"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any) => [formatCurrency(Number(v)), 'Revenue']}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {data.topProducts.map((_, i) => (
                      <rect key={i} fill={chartColors[i % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ── Store Performance Table ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Store Performance</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Click a row to see store detail. Sorted by{' '}
            <span className="font-medium">{sortCol}</span> {sortDir}.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left w-10">
                  #
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">
                  Store
                </th>
                {user.role !== 'cluster_manager' && (
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">
                    Cluster
                  </th>
                )}
                <SortHeader col="revenue"      label="Revenue"       active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader col="bills"        label="Bills"         active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader col="units"        label="Units Sold"    active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader col="avgBillValue" label="Avg Bill Value" active={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">
                  vs Prev Period
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} cols={user.role === 'cluster_manager' ? 7 : 8} />
              ) : sortedStores.length === 0 ? (
                <tr>
                  <td colSpan={user.role === 'cluster_manager' ? 7 : 8} className="px-4 py-10 text-center text-sm text-slate-400">
                    No sales data for this period.
                  </td>
                </tr>
              ) : (
                sortedStores.map((row, idx) => {
                  const isSelected = row.storeId === selectedStoreId
                  return (
                    <tr
                      key={row.storeId}
                      onClick={() => setSelectedStoreId(isSelected ? null : row.storeId)}
                      className={cn(
                        'border-b border-slate-100 cursor-pointer transition-colors',
                        isSelected
                          ? 'bg-indigo-50 border-indigo-200'
                          : 'hover:bg-slate-50'
                      )}
                    >
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('font-medium', isSelected ? 'text-indigo-700' : 'text-slate-800')}>
                          {row.storeName}
                        </span>
                      </td>
                      {user.role !== 'cluster_manager' && (
                        <td className="px-4 py-3 text-slate-500 text-xs">{row.clusterName}</td>
                      )}
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 tabular-nums">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {formatNumber(row.bills)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {formatNumber(row.units)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {formatCurrency(row.avgBillValue)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <GrowthBadge pct={row.growth} />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {!loading && sortedStores.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={user.role !== 'cluster_manager' ? 3 : 2}
                    className="px-4 py-3 text-xs font-semibold text-slate-500">
                    TOTAL ({sortedStores.length} stores)
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">
                    {formatCurrency(data?.totals.revenue ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums">
                    {formatNumber(data?.totals.bills ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums">
                    {formatNumber(data?.totals.units ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums">
                    {formatCurrency(data?.totals.avgBillValue ?? 0)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Cluster Comparison Table ──────────────────────────────────────── */}
      {user.role !== 'cluster_manager' && !loading && (data?.clusterSummary.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Cluster Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left">
                    Cluster
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">
                    Revenue
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">
                    Bills
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">
                    Avg Bill Value
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">
                    Stores
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.clusterSummary ?? []).map(row => (
                  <tr key={row.clusterId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.clusterName}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 tabular-nums">
                      {formatCurrency(row.revenue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {formatNumber(row.bills)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                      {formatCurrency(row.avgBillValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                      {row.storeCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
