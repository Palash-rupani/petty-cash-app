import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const category_id = searchParams.get('category_id')
  const date_from = searchParams.get('date_from')
  const date_to = searchParams.get('date_to')

  const supabase = await createClient()

  let query = supabase
    .from('expenses')
    .select(`
      *,
      store:stores(id, name),
      category:categories(id, name),
      creator:users!expenses_created_by_fkey(id, name, email)
    `)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (category_id) query = query.eq('category_id', category_id)
  if (date_from) query = query.gte('expense_month', date_from)
  if (date_to) query = query.lte('expense_month', date_to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('store_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'store_manager') {
    return NextResponse.json({ error: 'Only store managers can create expenses' }, { status: 403 })
  }

  const now = new Date()

  const expenseMonth =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      store_id: profile.store_id,
      created_by: user.id,
      category_id: body.category_id,
      amount: body.amount,
      description: body.description,
      receipt_url: body.receipt_url ?? null,
      expense_month: expenseMonth,
      status: body.status ?? 'draft',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    expense_id: data.id,
    action: body.status === 'submitted' ? 'submitted' : 'draft_saved',
    performed_by: user.id,
    remarks: body.status === 'submitted' ? 'Submitted for approval' : 'Saved as draft',
  })

  return NextResponse.json(data, { status: 201 })
}
