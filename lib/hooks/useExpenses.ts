'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Expense } from '@/types'

interface UseExpensesOptions {
  status?: string
  category_id?: string
  date_from?: string
  date_to?: string
}

export function useExpenses(options: UseExpensesOptions = {}) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('expenses')
        .select(`
          *,
          store:stores(id, name, monthly_limit),
          category:categories(id, name),
          creator:users!expenses_created_by_fkey(id, name, email, role)
        `)
        .order('created_at', { ascending: false })

      if (options.status) query = query.eq('status', options.status)
      if (options.category_id) query = query.eq('category_id', options.category_id)
      if (options.date_from) query = query.gte('expense_month', options.date_from)
      if (options.date_to) query = query.lte('expense_month', options.date_to)

      const { data, error: fetchError } = await query

      if (fetchError) throw fetchError
      setExpenses((data as Expense[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }, [options.status, options.category_id, options.date_from, options.date_to])

  useEffect(() => {
    fetchExpenses()
  }, [fetchExpenses])

  return { expenses, loading, error, refetch: fetchExpenses }
}
