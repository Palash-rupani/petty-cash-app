import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

// ── RPC row shapes ─────────────────────────────────────────────────────────────

interface RpcStoreSummaryRow {
  store_id:     string
  revenue:      number
  bills:        number
  units:        number
  prev_revenue: number
}

interface RpcTotalsRow {
  revenue: number
  bills:   number
  units:   number
}

interface RpcDailyRow  { date: string; revenue: number }
interface RpcProductRow { barcode: string; revenue: number; qty: number }

// ── Date helpers ──────────────────────────────────────────────────────────────

function startOfCurrentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function endOfCurrentMonth(): string {
  const now  = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return last.toISOString().split('T')[0]
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + deltaDays)
  return d.toISOString().split('T')[0]
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient()

  // 1. Auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Role guard — admin, accounting, cluster_manager
  const { data: profile } = await supabase
    .from('users')
    .select('role, cluster_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'accounting', 'cluster_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const storeId   = searchParams.get('store_id')   || null
  const clusterId = searchParams.get('cluster_id') || null
  const dateFrom  = searchParams.get('date_from')  || startOfCurrentMonth()
  const dateTo    = searchParams.get('date_to')    || endOfCurrentMonth()

  // 3. Cluster managers are always scoped to their own cluster
  const effectiveClusterId =
    profile.role === 'cluster_manager' ? (profile.cluster_id ?? null) : clusterId

  // 4. Resolve cluster → store IDs (empty → no data in that cluster)
  let filterStoreIds: string[] | null = null
  if (effectiveClusterId) {
    const { data: cs } = await supabase
      .from('stores')
      .select('id')
      .eq('cluster_id', effectiveClusterId)
    filterStoreIds = (cs ?? []).map(s => s.id)
    if (filterStoreIds.length === 0) {
      return NextResponse.json({
        totals:         { revenue: 0, bills: 0, units: 0, avgBillValue: 0 },
        storeSummary:   [],
        clusterSummary: [],
        dailyTrend:     [],
        topProducts:    [],
      })
    }
  }

  // 5. Previous period — same calendar duration, shifted back
  const d1       = new Date(dateFrom)
  const d2       = new Date(dateTo)
  const days     = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1
  const prevFrom = shiftDate(dateFrom, -days)
  const prevTo   = shiftDate(dateTo,   -days)

  // 6. Shared RPC params
  const base = {
    p_date_from:  dateFrom,
    p_date_to:    dateTo,
    p_store_id:   storeId,
    p_store_ids:  filterStoreIds,   // null = no filter; string[] = restrict to these stores
  }

  // 7. All four DB aggregations run in parallel — no raw row fetching
  const [totalsRes, summaryRes, trendRes, productsRes, storesRes, clustersRes] =
    await Promise.all([
      supabase.rpc('sp_totals', base),
      supabase.rpc('sp_store_summary', { ...base, p_prev_from: prevFrom, p_prev_to: prevTo }),
      supabase.rpc('sp_daily_trend',   base),
      supabase.rpc('sp_top_products',  { ...base, p_limit: 10 }),
      supabase.from('stores').select('id, name, cluster_id'),
      supabase.from('clusters').select('id, name'),
    ])

  // 8. Surface any DB errors
  for (const res of [totalsRes, summaryRes, trendRes, productsRes]) {
    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 })
    }
  }

  // 9. Lookup maps for store / cluster name enrichment
  const storeMap: Record<string, { name: string; clusterId: string }> =
    Object.fromEntries((storesRes.data ?? []).map(s => [s.id, { name: s.name, clusterId: s.cluster_id }]))

  const clusterMap: Record<string, string> =
    Object.fromEntries((clustersRes.data ?? []).map(c => [c.id, c.name]))

  // 10. Global totals (single row from sp_totals)
  const totalsRow = ((totalsRes.data ?? []) as RpcTotalsRow[])[0] ?? { revenue: 0, bills: 0, units: 0 }
  const totRevenue = Number(totalsRow.revenue) || 0
  const totBills   = Number(totalsRow.bills)   || 0
  const totUnits   = Number(totalsRow.units)   || 0

  const totals = {
    revenue:      totRevenue,
    bills:        totBills,
    units:        totUnits,
    avgBillValue: totBills > 0 ? Math.round(totRevenue / totBills) : 0,
  }

  // 11. Store summary — enrich each RPC row with names + growth
  const summaryRows = (summaryRes.data ?? []) as RpcStoreSummaryRow[]

  const storeSummary: StorePerfRow[] = summaryRows
    .map(row => {
      const info    = storeMap[row.store_id]
      const revenue = Number(row.revenue)      || 0
      const bills   = Number(row.bills)        || 0
      const units   = Number(row.units)        || 0
      const last    = Number(row.prev_revenue) || 0
      const growth  = last > 0
        ? Math.round(((revenue - last) / last) * 1000) / 10
        : null
      return {
        storeId:           row.store_id,
        storeName:         info?.name      ?? row.store_id,
        clusterId:         info?.clusterId ?? '',
        clusterName:       clusterMap[info?.clusterId ?? ''] ?? 'Unknown',
        revenue,
        bills,
        units,
        avgBillValue:      bills > 0 ? Math.round(revenue / bills) : 0,
        revenueLastPeriod: last,
        growth,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  // 12. Cluster comparison — aggregate store rows by cluster
  const clusterAgg: Record<string, {
    name: string; revenue: number; bills: number; storeIds: Set<string>
  }> = {}

  for (const row of storeSummary) {
    if (!row.clusterId) continue
    if (!clusterAgg[row.clusterId]) {
      clusterAgg[row.clusterId] = { name: row.clusterName, revenue: 0, bills: 0, storeIds: new Set() }
    }
    clusterAgg[row.clusterId].revenue += row.revenue
    clusterAgg[row.clusterId].bills   += row.bills
    clusterAgg[row.clusterId].storeIds.add(row.storeId)
  }

  const clusterSummary: ClusterPerfRow[] = Object.entries(clusterAgg)
    .map(([cid, v]) => ({
      clusterId:    cid,
      clusterName:  v.name,
      revenue:      v.revenue,
      bills:        v.bills,
      avgBillValue: v.bills > 0 ? Math.round(v.revenue / v.bills) : 0,
      storeCount:   v.storeIds.size,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // 13. Daily trend — already ordered by date from the DB
  const dailyTrend: DailyPoint[] = ((trendRes.data ?? []) as RpcDailyRow[])
    .map(r => ({ date: r.date, revenue: Number(r.revenue) || 0 }))

  // 14. Top products — already ordered by revenue desc from the DB
  const topProducts: ProductRow[] = ((productsRes.data ?? []) as RpcProductRow[])
    .map(r => ({ barcode: r.barcode, revenue: Number(r.revenue) || 0, qty: Number(r.qty) || 0 }))

  return NextResponse.json({ totals, storeSummary, clusterSummary, dailyTrend, topProducts })
}
