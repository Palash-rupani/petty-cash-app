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

    const newStatus = isAccounting ? 'accounting_approved' : 'cluster_approved'
    const approverField = isAccounting ? 'accounting_approved_by' : 'cluster_approved_by'

    // ── 1. Status-guarded update ───────────────────────────────────────────
    // Only update rows in the exact expected prior state to prevent
    // stale or duplicate approvals from succeeding silently.
    const expectedPriorStatus = isAccounting ? 'cluster_approved' : 'submitted'

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

    // No row matched — expense has moved to a different state already
    if (!updatedRows || updatedRows.length === 0) {
      return { error: 'Expense is no longer eligible for approval' }
    }

    const expense = updatedRows[0]

    // ── 2. Ledger debit (accounting approval only) ─────────────────────────
    // Directly attempt the insert and rely on the UNIQUE constraint on
    // cash_transactions(reference_expense_id) for idempotency.
    // No pre-check select — that pattern is race-condition unsafe.
    if (isAccounting) {
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
          // Duplicate — constraint caught a concurrent insert.
          // Debit already recorded; treat as idempotent success.
          console.warn(
            `[useApprovals] Duplicate ledger debit suppressed for expense ${expenseId} — already recorded.`
          )
        } else {
          // Genuine ledger failure — surface the error and halt.
          // The expense status update has already committed; the caller
          // should handle this edge case (e.g. alert finance ops).
          return { error: `Ledger write failed: ${ledgerError.message}` }
        }
      }
    }

    // ── 3. Audit log ───────────────────────────────────────────────────────
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

    const newStatus =
      role === 'cluster_manager' ? 'cluster_rejected' : 'accounting_rejected'

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