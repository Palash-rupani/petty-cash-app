import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ─── PATCH /api/expenses/[id] ─────────────────────────────────────────────────
// Allowed operations:
//   • Edit draft fields  (status === 'draft', own expense, store_manager)
//   • Submit for approval (status: 'draft' → 'submitted')
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'store_manager') {
    return NextResponse.json(
      { error: 'Only store managers can update expenses' },
      { status: 403 }
    )
  }

  // Fetch the existing expense to verify ownership + status
  const { data: existing, error: fetchError } = await supabase
    .from('expenses')
    .select('id, status, created_by')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  if (existing.created_by !== user.id) {
    return NextResponse.json(
      { error: 'You can only edit your own expenses' },
      { status: 403 }
    )
  }

  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only draft expenses can be edited or submitted' },
      { status: 422 }
    )
  }

  // Build the update payload — only include fields present in body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updated_by: user.id }

  if (body.category_id !== undefined) updates.category_id = body.category_id
  if (body.amount      !== undefined) updates.amount      = body.amount
  if (body.description !== undefined) updates.description = body.description
  if (body.receipt_url !== undefined) updates.receipt_url = body.receipt_url
  if (body.status      !== undefined) {
    // Only allow draft → submitted transition via this route
    if (body.status !== 'submitted') {
      return NextResponse.json({ error: 'Invalid status transition' }, { status: 422 })
    }
    updates.status = 'submitted'
  }

  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', id)
    .select(`
      *,
      store:stores(id, name, monthly_limit),
      category:categories(id, name),
      creator:users!expenses_created_by_fkey(id, name, email)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit log
  const action =
    updates.status === 'submitted' ? 'submitted' : 'draft_updated'
  const remarks =
    updates.status === 'submitted'
      ? 'Submitted for approval'
      : 'Draft updated'

  await supabase.from('audit_logs').insert({
    expense_id: id,
    action,
    performed_by: user.id,
    remarks,
  })

  return NextResponse.json(data)
}

// ─── DELETE /api/expenses/[id] ────────────────────────────────────────────────
// Permanently deletes a draft expense (only owner, only draft status).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'store_manager') {
    return NextResponse.json(
      { error: 'Only store managers can delete expenses' },
      { status: 403 }
    )
  }

  // Verify ownership + draft status
  const { data: existing, error: fetchError } = await supabase
    .from('expenses')
    .select('id, status, created_by')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  if (existing.created_by !== user.id) {
    return NextResponse.json(
      { error: 'You can only delete your own expenses' },
      { status: 403 }
    )
  }

  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only draft expenses can be deleted' },
      { status: 422 }
    )
  }

  // Delete audit logs first (FK constraint)
  await supabase.from('audit_logs').delete().eq('expense_id', id)

  const { error } = await supabase.from('expenses').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
