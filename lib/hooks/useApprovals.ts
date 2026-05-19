'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Expense } from '@/types'

export function useApprovals() {

  const [pendingExpenses, setPendingExpenses] =
    useState<Expense[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const supabase = createClient()

  // ────────────────────────────────────────────────────────────────────────
  // Fetch approval queue
  // ────────────────────────────────────────────────────────────────────────
  const fetchPending = useCallback(async () => {

    setLoading(true)
    setError(null)

    try {

      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()

      if (!authUser) {
        throw new Error('Not authenticated')
      }

      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', authUser.id)
        .single()

      const role = userData?.role

      /**
       * Cluster managers:
       * operational treasury approvals
       *
       * Accounting:
       * supervisory review only
       */
      const statusFilter =
        role === 'accounting'
          ? 'cluster_approved'
          : 'submitted'

      const { data, error: fetchError } = await supabase
        .from('expenses')
        .select(`
          *,
          store:stores(id, name, monthly_limit),
          category:categories(id, name),
          creator:users!expenses_created_by_fkey(
            id,
            name,
            email
          )
        `)
        .eq('status', statusFilter)
        .order('created_at', {
          ascending: true,
        })

      if (fetchError) {
        throw fetchError
      }

      setPendingExpenses(
        (data as Expense[]) ?? []
      )

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load approvals'
      )

    } finally {

      setLoading(false)
    }

  }, [])

  // ────────────────────────────────────────────────────────────────────────
  // Approve expense
  // ────────────────────────────────────────────────────────────────────────
  const approveExpense = async (
    expenseId: string,
    role: string,
    remarks?: string
  ): Promise<{ error: string | null }> => {

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return {
        error: 'Not authenticated',
      }
    }

    /**
     * Accounting is now supervisory only.
     * No operational approval allowed.
     */
    if (role === 'accounting') {

      return {
        error:
          'Accounting can no longer operationally approve expenses.',
      }
    }

    /**
     * Cluster manager approval:
     * final treasury execution
     */
    const { error: rpcError } =
      await supabase.rpc(
        'approve_expense',
        {
          p_expense_id: expenseId,
          p_approver_id: user.id,
          p_remarks:
            remarks ??
            'Final treasury approval',
        }
      )

    if (rpcError) {
      return {
        error: rpcError.message,
      }
    }

    await fetchPending()

    return {
      error: null,
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Reject expense
  // ────────────────────────────────────────────────────────────────────────
  const rejectExpense = async (
    expenseId: string,
    role: string,
    rejectionReason: string
  ): Promise<{ error: string | null }> => {

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return {
        error: 'Not authenticated',
      }
    }

    /**
     * Accounting is supervisory only.
     */
    if (role === 'accounting') {

      return {
        error:
          'Accounting can no longer operationally reject expenses.',
      }
    }

    /**
     * Cluster rejection:
     * release reservation
     * close treasury exposure
     */
    const { error: rpcError } =
      await supabase.rpc(
        'reject_expense',
        {
          p_expense_id: expenseId,
          p_approver_id: user.id,
          p_rejection_reason:
            rejectionReason,
        }
      )

    if (rpcError) {
      return {
        error: rpcError.message,
      }
    }

    await fetchPending()

    return {
      error: null,
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Initial fetch
  // ────────────────────────────────────────────────────────────────────────
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