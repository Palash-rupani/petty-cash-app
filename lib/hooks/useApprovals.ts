'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Expense } from '@/types'

export function useApprovals() {
  const [pendingExpenses, setPendingExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const fetchPending = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) throw new Error('Not authenticated')

      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', authUser.id)
        .single()

      const role = userData?.role
      let statusFilter = 'submitted'
      if (role === 'accounting') statusFilter = 'cluster_approved'

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

  const approveExpense = async (expenseId: string, role: string, remarks?: string) => {
    const newStatus = role === 'cluster_manager' ? 'cluster_approved' : 'accounting_approved'
    const approverField = role === 'cluster_manager' ? 'cluster_approved_by' : 'accounting_approved_by'

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not authenticated' }

    const { error: updateError } = await supabase
      .from('expenses')
      .update({ status: newStatus, [approverField]: user.id })
      .eq('id', expenseId)

    if (updateError) return { error: updateError.message }

    await supabase.from('audit_logs').insert({
      expense_id: expenseId,
      action: newStatus,
      performed_by: user.id,
      remarks: remarks ?? `Approved by ${role.replace('_', ' ')}`,
    })

    await fetchPending()
    return { error: null }
  }

  const rejectExpense = async (expenseId: string, role: string, rejectionReason: string) => {
    const newStatus = role === 'cluster_manager' ? 'cluster_rejected' : 'accounting_rejected'

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not authenticated' }

    const { error: updateError } = await supabase
      .from('expenses')
      .update({ status: newStatus, rejection_reason: rejectionReason })
      .eq('id', expenseId)

    if (updateError) return { error: updateError.message }

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

  return { pendingExpenses, loading, error, approveExpense, rejectExpense, refetch: fetchPending }
}
