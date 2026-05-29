import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()

  // 1. Auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Role guard — accounting or cluster_manager
  const { data: profile } = await supabase
    .from('users')
    .select('role, cluster_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['accounting', 'cluster_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const expenseId = searchParams.get('id')
  if (!expenseId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  // 3. Fetch expense with joins
  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .select(
      `id, amount, status, description, receipt_url, expense_month, created_at, updated_at,
       rejection_reason, tally_sync_status, tally_voucher_id,
       cluster_approved_by, accounting_approved_by,
       store:stores!store_id(id, name, cluster_id, monthly_limit),
       category:categories!category_id(id, name),
       creator:users!expenses_created_by_fkey(id, name)`
    )
    .eq('id', expenseId)
    .single()

  if (expenseError || !expense) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  const store     = expense.store as any
  const storeId   = store?.id         ?? null
  const clusterId = store?.cluster_id ?? null

  // Cluster managers may only view expenses from stores in their own cluster.
  if (profile.role === 'cluster_manager') {
    if (!profile.cluster_id || clusterId !== profile.cluster_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // 4. Fetch audit log timeline
  const { data: auditLogs } = await supabase
    .from('audit_logs')
    .select('id, action, remarks, created_at, performed_by')
    .eq('expense_id', expenseId)
    .order('created_at', { ascending: true })

  // 5. Collect all user IDs that need name resolution
  const rawUserIds = [
    ...(auditLogs ?? []).map(l => l.performed_by),
    expense.cluster_approved_by,
    expense.accounting_approved_by,
  ].filter((id): id is string => Boolean(id))
  const uniqueUserIds = [...new Set(rawUserIds)]

  // 6. Compute month date boundaries from expense_month
  const expMonthStr = typeof expense.expense_month === 'string'
    ? expense.expense_month.substring(0, 7)   // "YYYY-MM"
    : null

  let monthStart     = ''
  let nextMonthStart = ''
  if (expMonthStr) {
    const [yr, mo] = expMonthStr.split('-').map(Number)
    monthStart     = `${yr}-${String(mo).padStart(2, '0')}-01`
    nextMonthStart = mo === 12
      ? `${yr + 1}-01-01`
      : `${yr}-${String(mo + 1).padStart(2, '0')}-01`
  }

  // 7. All secondary fetches in parallel
  const [
    usersRes,
    clustersRes,
    spendRes,
    approvedSpendRes,
    txnsRes,
    relatedRes,
  ] = await Promise.all([
    // User name lookup
    uniqueUserIds.length > 0
      ? supabase.from('users').select('id, name').in('id', uniqueUserIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),

    // Cluster name
    clusterId
      ? supabase.from('clusters').select('id, name').eq('id', clusterId).single()
      : Promise.resolve({ data: null, error: null }),

    // This-month spend (submitted + all approved states)
    storeId && monthStart
      ? supabase
          .from('expenses')
          .select('amount')
          .eq('store_id', storeId)
          .gte('expense_month', monthStart)
          .lt('expense_month', nextMonthStart)
          .in('status', ['submitted', 'cluster_approved', 'accounting_approved', 'approved', 'synced_to_tally'])
      : Promise.resolve({ data: [] as { amount: number }[], error: null }),

    // This-month approved spend only
    storeId && monthStart
      ? supabase
          .from('expenses')
          .select('amount')
          .eq('store_id', storeId)
          .gte('expense_month', monthStart)
          .lt('expense_month', nextMonthStart)
          .in('status', ['cluster_approved', 'accounting_approved', 'approved', 'synced_to_tally'])
      : Promise.resolve({ data: [] as { amount: number }[], error: null }),

    // Cash ledger balance from cash_transactions
    storeId
      ? supabase.from('cash_transactions').select('type, amount').eq('store_id', storeId)
      : Promise.resolve({ data: [] as { type: string; amount: number }[], error: null }),

    // 5 most recent expenses from the same store (excluding this one)
    storeId
      ? supabase
          .from('expenses')
          .select('id, amount, status, expense_month, created_at, category:categories!category_id(name)')
          .eq('store_id', storeId)
          .neq('id', expenseId)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as any[], error: null }),
  ])

  // 8. User name map
  const userMap: Record<string, string> = Object.fromEntries(
    (usersRes.data ?? []).map(u => [u.id, u.name])
  )

  const clusterName: string = (clustersRes.data as any)?.name ?? 'Unknown'

  // 9. Audit timeline
  const timeline = (auditLogs ?? []).map(log => ({
    id:          log.id,
    action:      log.action,
    remarks:     log.remarks   ?? null,
    performedBy: userMap[log.performed_by] ?? 'Unknown',
    createdAt:   log.created_at,
  }))

  // 10. Financial context
  const spendData        = (spendRes.data        ?? []) as { amount: number }[]
  const approvedData     = (approvedSpendRes.data ?? []) as { amount: number }[]
  const txnData          = (txnsRes.data          ?? []) as { type: string; amount: number }[]
  const txnError         = txnsRes.error

  const currentMonthSpend         = spendData.reduce((s, e)    => s + Number(e.amount), 0)
  const currentMonthApprovedSpend = approvedData.reduce((s, e) => s + Number(e.amount), 0)

  let actualBalance: number | null = null
  if (!txnError) {
    actualBalance = txnData.reduce((total, txn) => {
      if (txn.type === 'credit' || txn.type === 'adjustment') return total + Number(txn.amount)
      if (txn.type === 'debit')                               return total - Number(txn.amount)
      return total
    }, 0)
  }

  const monthlyLimit = Number(store?.monthly_limit) || 0

  // 11. Related expenses
  const relatedExpenses = ((relatedRes.data ?? []) as any[]).map(r => ({
    id:            r.id,
    amount:        r.amount,
    status:        r.status,
    expense_month: r.expense_month,
    created_at:    r.created_at,
    category_name: (r.category as any)?.name ?? null,
  }))

  return NextResponse.json({
    expense: {
      id:                     expense.id,
      amount:                 expense.amount,
      status:                 expense.status,
      description:            expense.description          ?? null,
      receipt_url:            expense.receipt_url          ?? null,
      expense_month:          expense.expense_month,
      rejection_reason:       expense.rejection_reason     ?? null,
      tally_sync_status:      expense.tally_sync_status    ?? null,
      tally_voucher_id:       expense.tally_voucher_id     ?? null,
      created_at:             expense.created_at,
      updated_at:             expense.updated_at,
      store: storeId ? {
        id:            storeId,
        name:          store.name          ?? null,
        cluster_name:  clusterName,
        monthly_limit: monthlyLimit,
      } : null,
      category:               expense.category ?? null,
      creator:                expense.creator  ?? null,
      cluster_approved_by:    expense.cluster_approved_by
        ? (userMap[expense.cluster_approved_by] ?? null)
        : null,
      accounting_approved_by: expense.accounting_approved_by
        ? (userMap[expense.accounting_approved_by] ?? null)
        : null,
    },
    timeline,
    financialContext: {
      monthlyLimit,
      currentMonthSpend,
      currentMonthApprovedSpend,
      actualBalance,
    },
    relatedExpenses,
  })
}
