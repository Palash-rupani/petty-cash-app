import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()

  // 1. Auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Role guard — accounting only
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'accounting') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)

  const isExport = searchParams.get('export') === 'true'
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('page_size') ?? '25', 10)))

  const ALLOWED_SORT = ['created_at', 'amount', 'expense_month', 'status'] as const
  type SortCol = typeof ALLOWED_SORT[number]
  const rawSort   = searchParams.get('sort_col') ?? 'created_at'
  const sortCol   = ALLOWED_SORT.includes(rawSort as SortCol) ? (rawSort as SortCol) : 'created_at'
  const ascending = searchParams.get('sort_dir') === 'asc'

  const storeId    = searchParams.get('store_id')    || null
  const clusterId  = searchParams.get('cluster_id')  || null
  const categoryId = searchParams.get('category_id') || null
  const status     = searchParams.get('status')      || null
  const dateFrom   = searchParams.get('date_from')   || null
  const dateTo     = searchParams.get('date_to')     || null

  // 3. Resolve cluster → store IDs for filtering
  let clusterStoreIds: string[] | null = null
  if (clusterId) {
    const { data: cs } = await supabase
      .from('stores')
      .select('id')
      .eq('cluster_id', clusterId)
    clusterStoreIds = (cs ?? []).map(s => s.id)
    if (clusterStoreIds.length === 0) {
      return NextResponse.json({ data: [], count: 0 })
    }
  }

  // 4. Build query
  const from = isExport ? 0 : (page - 1) * pageSize
  const to   = isExport ? 4999 : from + pageSize - 1

  let q = supabase
    .from('expenses')
    .select(
      `id, amount, status, description, expense_month, created_at, cluster_approved_by,
       store:stores!store_id(id, name, cluster_id),
       category:categories!category_id(id, name),
       creator:users!expenses_created_by_fkey(id, name)`,
      { count: 'exact' }
    )
    .order(sortCol, { ascending })
    .range(from, to)

  if (storeId)           q = q.eq('store_id', storeId)
  if (clusterStoreIds)   q = q.in('store_id', clusterStoreIds)
  if (categoryId)        q = q.eq('category_id', categoryId)
  if (status)            q = q.eq('status', status)
  if (dateFrom)          q = q.gte('expense_month', dateFrom)
  if (dateTo)            q = q.lte('expense_month', dateTo)

  const { data: expenses, error: fetchError, count } = await q

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  const rows = expenses ?? []

  // 5. Enrich: cluster names (server-side join via separate lookup)
  const clusterIds = [...new Set(rows.map(e => (e.store as any)?.cluster_id).filter(Boolean))]
  let clusterMap: Record<string, string> = {}
  if (clusterIds.length > 0) {
    const { data: clusters } = await supabase
      .from('clusters')
      .select('id, name')
      .in('id', clusterIds)
    clusterMap = Object.fromEntries((clusters ?? []).map(c => [c.id, c.name]))
  }

  // 6. Enrich: approver names for cluster_approved_by
  const approverIds = [...new Set(rows.map(e => (e as any).cluster_approved_by).filter(Boolean))]
  let approverMap: Record<string, string> = {}
  if (approverIds.length > 0) {
    const { data: approvers } = await supabase
      .from('users')
      .select('id, name')
      .in('id', approverIds)
    approverMap = Object.fromEntries((approvers ?? []).map(u => [u.id, u.name]))
  }

  const enriched = rows.map(e => {
    const store = e.store as any
    const approvedById = (e as any).cluster_approved_by
    return {
      id:              e.id,
      amount:          e.amount,
      status:          e.status,
      description:     e.description,
      expense_month:   e.expense_month,
      created_at:      e.created_at,
      store:           store ? {
        id:           store.id,
        name:         store.name,
        cluster_id:   store.cluster_id,
        cluster_name: clusterMap[store.cluster_id] ?? 'Unknown',
      } : null,
      category:        e.category,
      creator:         e.creator,
      approver_name:   approvedById ? (approverMap[approvedById] ?? null) : null,
    }
  })

  return NextResponse.json({ data: enriched, count: count ?? 0 })
}
