import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ── Types returned by this endpoint ──────────────────────────────────────────

interface StoreSummaryRow {
  storeId:     string
  storeName:   string
  clusterId:   string
  clusterName: string
  thisMonth:   number
  lastMonth:   number
  diff:        number
  count:       number   // this-month expense count
}

interface ClusterSummaryRow {
  clusterId:    string
  clusterName:  string
  total:        number  // this-month total
  storeCount:   number
  avgPerStore:  number
}

interface MonthTrend {
  month:  string  // "May '25"
  amount: number
}

interface CategoryRow {
  name:   string
  amount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-IN', {
    month: 'short',
    year:  '2-digit',
  })
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const supabase = await createClient()

  // 1. Auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Role guard
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'accounting') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const storeId    = searchParams.get('store_id')    || null
  const clusterId  = searchParams.get('cluster_id')  || null
  const categoryId = searchParams.get('category_id') || null
  const statusFlt  = searchParams.get('status')      || null

  // 3. Date keys
  const now           = new Date()
  const thisMonthKey  = monthKey(now)
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthKey  = monthKey(lastMonthDate)
  const sixMonthsAgo  = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const sixMonthsKey  = monthKey(sixMonthsAgo)

  // 4. Resolve cluster → store IDs
  let filterStoreIds: string[] | null = null
  if (clusterId) {
    const { data: cs } = await supabase.from('stores').select('id').eq('cluster_id', clusterId)
    filterStoreIds = (cs ?? []).map(s => s.id)
    if (filterStoreIds.length === 0) {
      return NextResponse.json({
        thisMonthTotal:       0,
        lastMonthTotal:       0,
        pendingCount:         0,
        highestSpendingStore:   null,
        highestSpendingCluster: null,
        storeSummary:         [],
        clusterSummary:       [],
        monthlyTrend:         [],
        categoryBreakdown:    [],
        statusDistribution:   {},
      })
    }
  }

  // 5. Helper: apply shared non-date filters to a query
  // We type it as `any` because the supabase query builder's chained type is
  // complex — each filter returns a slightly different generic and we don't
  // need compile-time safety here since we control the inputs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilters(q: any): any {
    if (storeId)        q = q.eq('store_id', storeId)
    if (filterStoreIds) q = q.in('store_id', filterStoreIds)
    if (categoryId)     q = q.eq('category_id', categoryId)
    if (statusFlt)      q = q.eq('status', statusFlt)
    return q
  }

  // 6. Parallel fetches
  const [thisMonthRes, lastMonthRes, pendingRes, trendRes, storesRes, clustersRes, categoriesRes] =
    await Promise.all([
      // This month expenses
      applyFilters(
        supabase
          .from('expenses')
          .select('id, amount, store_id, category_id, status')
          .eq('expense_month', thisMonthKey)
      ),
      // Last month expenses
      applyFilters(
        supabase
          .from('expenses')
          .select('id, amount, store_id')
          .eq('expense_month', lastMonthKey)
      ),
      // Pending count (always 'submitted', ignores statusFlt)
      (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = supabase
          .from('expenses')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted')
        if (storeId)        q = q.eq('store_id', storeId)
        if (filterStoreIds) q = q.in('store_id', filterStoreIds)
        if (categoryId)     q = q.eq('category_id', categoryId)
        return q
      })(),
      // Last 6 months trend (for chart)
      applyFilters(
        supabase
          .from('expenses')
          .select('amount, expense_month, category_id, status')
          .gte('expense_month', sixMonthsKey)
          .lte('expense_month', thisMonthKey)
      ),
      // All stores (for name + cluster lookup)
      supabase.from('stores').select('id, name, cluster_id'),
      // All clusters
      supabase.from('clusters').select('id, name'),
      // All categories
      supabase.from('categories').select('id, name'),
    ])

  // Check for errors
  for (const res of [thisMonthRes, lastMonthRes, trendRes, storesRes, clustersRes, categoriesRes]) {
    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 })
    }
  }

  // 7. Build lookup maps
  const storeMap: Record<string, { name: string; clusterId: string }> =
    Object.fromEntries((storesRes.data ?? []).map(s => [s.id, { name: s.name, clusterId: s.cluster_id }]))

  const clusterMap: Record<string, string> =
    Object.fromEntries((clustersRes.data ?? []).map(c => [c.id, c.name]))

  const categoryMap: Record<string, string> =
    Object.fromEntries((categoriesRes.data ?? []).map(c => [c.id, c.name]))

  const thisMonthExpenses = (thisMonthRes.data ?? []) as {
    id: string; amount: number; store_id: string; category_id: string; status: string
  }[]
  const lastMonthExpenses = (lastMonthRes.data ?? []) as { id: string; amount: number; store_id: string }[]
  const trendExpenses     = (trendRes.data ?? []) as {
    amount: number; expense_month: string; category_id: string; status: string
  }[]

  // 8. Summary totals
  const thisMonthTotal = thisMonthExpenses.reduce((s, e) => s + (e.amount || 0), 0)
  const lastMonthTotal = lastMonthExpenses.reduce((s, e) => s + (e.amount || 0), 0)
  const pendingCount   = pendingRes.count ?? 0

  // 9. Store summary (this month vs last month)
  const storeAgg: Record<string, {
    name: string; clusterId: string; clusterName: string;
    thisMonth: number; lastMonth: number; count: number
  }> = {}

  for (const e of thisMonthExpenses) {
    const s = storeMap[e.store_id]
    if (!s) continue
    if (!storeAgg[e.store_id]) {
      storeAgg[e.store_id] = {
        name:        s.name,
        clusterId:   s.clusterId,
        clusterName: clusterMap[s.clusterId] ?? 'Unknown',
        thisMonth:   0,
        lastMonth:   0,
        count:       0,
      }
    }
    storeAgg[e.store_id].thisMonth += e.amount || 0
    storeAgg[e.store_id].count++
  }

  for (const e of lastMonthExpenses) {
    const s = storeMap[e.store_id]
    if (!s) continue
    if (!storeAgg[e.store_id]) {
      storeAgg[e.store_id] = {
        name:        s.name,
        clusterId:   s.clusterId,
        clusterName: clusterMap[s.clusterId] ?? 'Unknown',
        thisMonth:   0,
        lastMonth:   0,
        count:       0,
      }
    }
    storeAgg[e.store_id].lastMonth += e.amount || 0
  }

  const storeSummary: StoreSummaryRow[] = Object.entries(storeAgg)
    .map(([sid, v]) => ({
      storeId:     sid,
      storeName:   v.name,
      clusterId:   v.clusterId,
      clusterName: v.clusterName,
      thisMonth:   v.thisMonth,
      lastMonth:   v.lastMonth,
      diff:        v.thisMonth - v.lastMonth,
      count:       v.count,
    }))
    .sort((a, b) => b.thisMonth - a.thisMonth)

  // 10. Cluster summary
  const clusterAgg: Record<string, { name: string; total: number; storeIds: Set<string> }> = {}
  for (const row of storeSummary) {
    if (!clusterAgg[row.clusterId]) {
      clusterAgg[row.clusterId] = { name: row.clusterName, total: 0, storeIds: new Set() }
    }
    clusterAgg[row.clusterId].total += row.thisMonth
    clusterAgg[row.clusterId].storeIds.add(row.storeId)
  }

  const clusterSummary: ClusterSummaryRow[] = Object.entries(clusterAgg)
    .map(([cid, v]) => ({
      clusterId:   cid,
      clusterName: v.name,
      total:       v.total,
      storeCount:  v.storeIds.size,
      avgPerStore: v.storeIds.size > 0 ? Math.round(v.total / v.storeIds.size) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  // 11. Highest spending store / cluster
  const highestSpendingStore   = storeSummary[0]
    ? { name: storeSummary[0].storeName,   amount: storeSummary[0].thisMonth }
    : null
  const highestSpendingCluster = clusterSummary[0]
    ? { name: clusterSummary[0].clusterName, amount: clusterSummary[0].total }
    : null

  // 12. Monthly trend (last 6 months, approved + submitted)
  const trendMap: Record<string, number> = {}
  // Seed all 6 months with 0
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    trendMap[monthKey(d)] = 0
  }
  for (const e of trendExpenses) {
    const k = e.expense_month
    if (k in trendMap) trendMap[k] = (trendMap[k] ?? 0) + (e.amount || 0)
  }
  const monthlyTrend: MonthTrend[] = Object.entries(trendMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, amount]) => ({ month: monthLabel(k), amount }))

  // 13. Category breakdown (this month)
  const catAgg: Record<string, number> = {}
  for (const e of thisMonthExpenses) {
    const name = categoryMap[e.category_id] ?? 'Uncategorized'
    catAgg[name] = (catAgg[name] ?? 0) + (e.amount || 0)
  }
  const categoryBreakdown: CategoryRow[] = Object.entries(catAgg)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)

  // 14. Status distribution (this month)
  const statusDist: Record<string, number> = {}
  for (const e of thisMonthExpenses) {
    statusDist[e.status] = (statusDist[e.status] ?? 0) + 1
  }

  return NextResponse.json({
    thisMonthTotal,
    lastMonthTotal,
    pendingCount,
    highestSpendingStore,
    highestSpendingCluster,
    storeSummary,
    clusterSummary,
    monthlyTrend,
    categoryBreakdown,
    statusDistribution: statusDist,
  })
}
