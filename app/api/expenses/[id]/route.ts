import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ─── PATCH /api/expenses/[id] ─────────────────────────────────────────────────
// Allowed operations:
//   • Edit draft fields  (status === 'draft', own expense, store_manager)
//   • Submit for approval (status: 'draft' → 'submitted') via atomic RPC
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

  // ── draft → submitted: atomic RPC ─────────────────────────────────────────
  // Status update, treasury reservation, and audit log are written atomically
  // inside submit_expense_for_approval(). No partial state is possible.
  if (body.status === 'submitted') {
    const { error: rpcError } = await supabase.rpc('submit_expense_for_approval', {
      p_expense_id: id,
      p_user_id: user.id,
    })

    if (rpcError) {
      // Surface structured RPC error messages from RAISE EXCEPTION to the client
      const msg = rpcError.message ?? 'Submission failed'

      if (msg.includes('EXPENSE_NOT_FOUND')) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
      if (msg.includes('USER_NOT_FOUND')) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      if (msg.includes('FORBIDDEN')) return NextResponse.json({ error: 'You can only submit your own expenses' }, { status: 403 })
      if (msg.includes('INVALID_STATUS')) return NextResponse.json({ error: 'Only draft expenses can be submitted' }, { status: 422 })

      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Fetch the updated expense to return the same shape as before
    const { data: submitted, error: refetchError } = await supabase
      .from('expenses')
      .select(`
        *,
        store:stores(id, name, monthly_limit),
        category:categories(id, name),
        creator:users!expenses_created_by_fkey(id, name, email)
      `)
      .eq('id', id)
      .single()

    if (refetchError || !submitted) {
      return NextResponse.json({ error: 'Expense submitted but could not be retrieved' }, { status: 500 })
    }

    return NextResponse.json(submitted)
  }

  // ── Draft field edits (non-submission PATCH) ───────────────────────────────
  // Only allow status-free field updates here. Any attempt to set a status
  // other than 'submitted' is rejected — submission is handled above.
  if (body.status !== undefined) {
    return NextResponse.json({ error: 'Invalid status transition' }, { status: 422 })
  }

  // Build the update payload — only include fields present in body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updated_by: user.id }

  if (body.category_id !== undefined) updates.category_id = body.category_id
  if (body.amount !== undefined) updates.amount = body.amount
  if (body.description !== undefined) updates.description = body.description
  if (body.receipt_url !== undefined) updates.receipt_url = body.receipt_url

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

  // Audit log for draft edits (kept as direct insert — not treasury-critical)
  await supabase.from('audit_logs').insert({
    expense_id: id,
    action: 'draft_updated',
    performed_by: user.id,
    remarks: 'Draft updated',
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