'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Expense } from '@/types'

export function useApprovals() {
  const [pendingExpenses, setPendingExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  // ── Fetch pending expenses for the current user's role ────────────────────
  const fetchPending = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) throw new Error('Not authenticated')

      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', authUser.id)
        .single()

      const role = userData?.role
      const statusFilter = role === 'accounting' ? 'cluster_approved' : 'submitted'

      const { data, error: fetchError } = await supabase
        .from('expenses')
        .select(`
          *,
          store:stores(id, name, monthly_limit),
          category:categories(id, name),
          creator:users!expenses_created_by_fkey(id, name, email)
        `)
        .eq('status', statusFilter)
        .order('created_at', { ascending: true })

      if (fetchError) throw fetchError

      setPendingExpenses((data as Expense[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Approve expense ────────────────────────────────────────────────────────
  const approveExpense = async (
    expenseId: string,
    role: string,
    remarks?: string
  ): Promise<{ error: string | null }> => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return { error: 'Not authenticated' }

    const isAccounting = role === 'accounting'

    // ── Cluster manager approval: atomic RPC ──────────────────────────────
    if (!isAccounting) {
      const { error: rpcError } = await supabase.rpc('approve_expense', {
        p_expense_id: expenseId,
        p_approver_id: user.id,
        p_remarks: remarks ?? `Approved by ${role.replace('_', ' ')}`,
      })

      if (rpcError) return { error: rpcError.message }

      await fetchPending()
      return { error: null }
    }

    // ── Accounting compatibility flow (temporary — kept as-is) ─────────────
    const newStatus = 'accounting_approved'
    const approverField = 'accounting_approved_by'
    const expectedPriorStatus = 'cluster_approved'

    const { data: updatedRows, error: updateError } = await supabase
      .from('expenses')
      .update({
        status: newStatus,
        [approverField]: user.id,
      })
      .eq('id', expenseId)
      .eq('status', expectedPriorStatus)
      .select('id, store_id, amount, description')

    if (updateError) return { error: updateError.message }

    if (!updatedRows || updatedRows.length === 0) {
      return { error: 'Expense is no longer eligible for approval' }
    }

    const expense = updatedRows[0]

    // ── Ledger debit (accounting approval only) ────────────────────────────
    const { error: ledgerError } = await supabase
      .from('cash_transactions')
      .insert({
        store_id: expense.store_id,
        created_by: user.id,
        type: 'debit',
        amount: expense.amount,
        remarks: `Approved expense: ${expense.description ?? 'Expense deduction'}`,
        reference_expense_id: expenseId,
      })

    if (ledgerError) {
      if (ledgerError.code === '23505') {
        console.warn(
          `[useApprovals] Duplicate ledger debit suppressed for expense ${expenseId} — already recorded.`
        )
      } else {
        return { error: `Ledger write failed: ${ledgerError.message}` }
      }
    }

    // ── Audit log ──────────────────────────────────────────────────────────
    await supabase.from('audit_logs').insert({
      expense_id: expenseId,
      action: newStatus,
      performed_by: user.id,
      remarks: remarks ?? `Approved by ${role.replace('_', ' ')}`,
    })

    await fetchPending()

    return { error: null }
  }

  // ── Reject expense ─────────────────────────────────────────────────────────
  const rejectExpense = async (
    expenseId: string,
    role: string,
    rejectionReason: string
  ): Promise<{ error: string | null }> => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return { error: 'Not authenticated' }

    const isAccounting = role === 'accounting'

    // ── Cluster manager rejection: atomic RPC ──────────────────────────────
    if (!isAccounting) {
      const { error: rpcError } = await supabase.rpc('reject_expense', {
        p_expense_id: expenseId,
        p_approver_id: user.id,
        p_rejection_reason: rejectionReason,
      })

      if (rpcError) return { error: rpcError.message }

      await fetchPending()
      return { error: null }
    }

    // ── Accounting compatibility flow (temporary — kept as-is) ─────────────
    const newStatus = 'accounting_rejected'

    const { data: updatedRows, error: updateError } = await supabase
      .from('expenses')
      .update({
        status: newStatus,
        rejection_reason: rejectionReason,
      })
      .eq('id', expenseId)
      .select('id')

    if (updateError) return { error: updateError.message }

    if (!updatedRows || updatedRows.length === 0) {
      return { error: 'Expense could not be rejected — it may have already been actioned.' }
    }

    await supabase.from('audit_logs').insert({
      expense_id: expenseId,
      action: newStatus,
      performed_by: user.id,
      remarks: rejectionReason,
    })

    await fetchPending()

    return { error: null }
  }

  useEffect(() => {
    fetchPending()
  }, [fetchPending])

  return {
    pendingExpenses,
    loading,
    error,
    approveExpense,
    rejectExpense,
    refetch: fetchPending,
  }
}