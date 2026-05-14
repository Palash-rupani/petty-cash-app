'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { ReceiptUpload } from './ReceiptUpload'
import { Button } from '@/components/ui/Button'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import type { Category } from '@/types'

const schema = z.object({
  category_id: z.string().min(1, 'Category is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface ExpenseFormProps {
  onSuccess?: () => void
}

export function ExpenseForm({ onSuccess }: ExpenseFormProps) {
  const { user } = useAuth()

  const supabase = createClient()

  const [categories, setCategories] = useState<Category[]>([])

  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)

  const [receiptUploading, setReceiptUploading] = useState(false)

  const [monthlySpend, setMonthlySpend] = useState(0)

  const [monthlyLimit, setMonthlyLimit] = useState(10000)

  const [submitting, setSubmitting] = useState(false)

  const [saving, setSaving] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
  })

  const watchedAmount = watch('amount') ?? 0

  const wouldExceedLimit =
    monthlySpend + Number(watchedAmount) > monthlyLimit

  const isSubmitDisabled =
    submitting || saving || receiptUploading

  useEffect(() => {
    const fetchData = async () => {
      const { data: cats } = await supabase
        .from('categories')
        .select('*')
        .order('name')

      setCategories(cats ?? [])

      if (user?.store_id) {
        const now = new Date()

        const monthStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        )
          .toISOString()
          .split('T')[0]

        const [spendRes, storeRes] = await Promise.all([
          supabase
            .from('expenses')
            .select('amount')
            .eq('store_id', user.store_id)
            .gte('expense_month', monthStart)
            .not(
              'status',
              'in',
              '(draft,cluster_rejected,accounting_rejected)'
            ),

          supabase
            .from('stores')
            .select('monthly_limit')
            .eq('id', user.store_id)
            .single(),
        ])

        const spend = (spendRes.data ?? []).reduce(
          (s, e) => s + Number(e.amount),
          0
        )

        setMonthlySpend(spend)

        setMonthlyLimit(
          storeRes.data?.monthly_limit ?? 10000
        )
      }
    }

    fetchData()
  }, [user?.store_id])

  const submit = async (
    values: FormValues,
    status: 'draft' | 'submitted'
  ) => {
    if (!user?.store_id) {
      setError('No store associated with your account. Contact admin.')
      return
    }

    if (receiptUploading) {
      setError('Please wait for the receipt to finish uploading.')
      return
    }

    setError(null)

    const setSending = status === 'submitted' ? setSubmitting : setSaving
    setSending(true)

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: values.category_id,
          amount: values.amount,
          description: values.description ?? null,
          receipt_url: receiptUrl,
          status,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to create expense')
        return
      }

      setSuccess(true)
      reset()
      setReceiptUrl(null)

      setTimeout(() => {
        onSuccess?.()
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
          <CheckCircle
            size={24}
            className="text-green-500"
          />
        </div>

        <p className="text-slate-700 font-medium">
          Expense submitted!
        </p>

        <p className="text-slate-400 text-sm mt-1">
          Redirecting...
        </p>
      </div>
    )
  }

  return (
    <form className="space-y-5">
      {/* Category */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Category <span className="text-red-500">*</span>
        </label>

        <select
          {...register('category_id')}
          className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">
            Select a category
          </option>

          {categories.map((cat) => (
            <option
              key={cat.id}
              value={cat.id}
            >
              {cat.name}
            </option>
          ))}
        </select>

        {errors.category_id && (
          <p className="text-xs text-red-500 mt-1">
            {errors.category_id.message}
          </p>
        )}
      </div>

      {/* Amount */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Amount (₹){' '}
          <span className="text-red-500">*</span>
        </label>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
            ₹
          </span>

          <input
            type="number"
            step="0.01"
            min="0"
            {...register('amount')}
            placeholder="0.00"
            className="w-full pl-8 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {errors.amount && (
          <p className="text-xs text-red-500 mt-1">
            {errors.amount.message}
          </p>
        )}

        {wouldExceedLimit &&
          Number(watchedAmount) > 0 && (
            <div className="flex items-start gap-2 mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle
                size={14}
                className="text-amber-600 flex-shrink-0 mt-0.5"
              />

              <p className="text-xs text-amber-700">
                This would bring your monthly
                total to{' '}
                <strong>
                  {formatCurrency(
                    monthlySpend +
                    Number(watchedAmount)
                  )}
                </strong>
                , exceeding the{' '}
                {formatCurrency(monthlyLimit)} limit.
                You can still submit —
                accounting will review.
              </p>
            </div>
          )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Description
        </label>

        <textarea
          {...register('description')}
          rows={3}
          placeholder="Brief description of what was purchased..."
          className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      {/* Receipt */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Receipt{' '}
          <span className="text-slate-400 font-normal">
            (optional)
          </span>
        </label>

        <ReceiptUpload
          value={receiptUrl}
          onChange={setReceiptUrl}
          onUploadingChange={
            setReceiptUploading
          }
          disabled={isSubmitDisabled}
        />

        {receiptUploading && (
          <p className="text-xs text-indigo-500 mt-1">
            Uploading receipt, please wait...
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}

          <button
            type="button"
            className="ml-2 underline text-red-600 text-xs"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          loading={saving}
          disabled={isSubmitDisabled}
          onClick={() =>
            handleSubmit((v: FormValues) =>
              submit(v, 'draft')
            )()
          }
        >
          Save as Draft
        </Button>

        <Button
          type="button"
          className="flex-1"
          loading={submitting}
          disabled={isSubmitDisabled}
          onClick={() =>
            handleSubmit((v: FormValues) =>
              submit(v, 'submitted')
            )()
          }
        >
          {receiptUploading
            ? 'Uploading receipt...'
            : 'Submit for Approval'}
        </Button>
      </div>
    </form>
  )
}