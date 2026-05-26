'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { getAvailableBalance } from '@/lib/finance/getAvailableBalance'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { ReceiptUpload } from './ReceiptUpload'
import { Button } from '@/components/ui/Button'
import { AlertTriangle, CheckCircle, Landmark, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import type { Category } from '@/types'

const schema = z.object({
  category_id: z.string().min(1, 'Category is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  description: z
  .string()
  .trim()
  .min(1, 'Description is required'),
})

type FormValues = z.infer<typeof schema>

interface ExpenseFormProps {
  onSuccess?: () => void
}

// ── Treasury health thresholds ──────────────────────────────────────────────
// Health is derived from projected available balance relative to the target float.
type TreasuryHealth = 'healthy' | 'low' | 'negative'

function getTreasuryHealth(
  projectedAvailable: number | null,
  targetFloat: number
): TreasuryHealth {
  if (projectedAvailable === null) return 'healthy' // unknown — no warning shown
  if (projectedAvailable < 0) return 'negative'
  if (projectedAvailable < targetFloat) return 'low'  // below operational threshold
  return 'healthy'
}

const healthConfig: Record<
  TreasuryHealth,
  { label: string; icon: typeof ShieldCheck; className: string; dotClass: string }
> = {
  healthy: {
    label: 'Healthy Liquidity',
    icon: ShieldCheck,
    className: 'text-emerald-600',
    dotClass: 'bg-emerald-500',
  },
  low: {
    label: 'Low Available Liquidity',
    icon: ShieldAlert,
    className: 'text-amber-600',
    dotClass: 'bg-amber-400',
  },
  negative: {
    label: 'Negative Liquidity Risk',
    icon: ShieldX,
    className: 'text-red-600',
    dotClass: 'bg-red-500',
  },
}

export function ExpenseForm({ onSuccess }: ExpenseFormProps) {
  const { user } = useAuth()
  const supabase = createClient()

  const [categories, setCategories] = useState<Category[]>([])
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [receiptUploading, setReceiptUploading] = useState(false)

  // ── Treasury state (reservation-aware) ────────────────────────────────────
  // null = fetch failed; number = confirmed value (0 or negative are valid)
  const [actualBalance, setActualBalance] = useState<number | null>(null)
  const [reservedAmount, setReservedAmount] = useState<number | null>(null)
  const [availableBalance, setAvailableBalance] = useState<number | null>(null)
  const [activeReservationCount, setActiveReservationCount] = useState<number | null>(null)
  const [targetFloat, setTargetFloat] = useState(10000)

  // ── Submission state ───────────────────────────────────────────────────────
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

  const watchedAmount = Number(watch('amount') ?? 0)

  // ── Treasury calculations ──────────────────────────────────────────────────
  // Primary metric: projected available balance (available - entered amount)
  // Never fall back to ledger-only semantics.
  const projectedAvailableBalance =
    availableBalance !== null && watchedAmount > 0
      ? availableBalance - watchedAmount
      : null

  const wouldReduceLiquidity =
    projectedAvailableBalance !== null && watchedAmount > 0 && projectedAvailableBalance < 0

  const health = getTreasuryHealth(
    watchedAmount > 0 ? projectedAvailableBalance : availableBalance,
    targetFloat
  )
  const HealthIcon = healthConfig[health].icon

  const isSubmitDisabled = submitting || saving || receiptUploading

  // ── Treasury refresh — called on mount and after each submission ──────────
  const fetchTreasury = async () => {
    if (!user?.store_id) return
    const [balanceData, storeRes] = await Promise.all([
      getAvailableBalance(user.store_id),
      supabase
        .from('stores')
        .select('monthly_limit')
        .eq('id', user.store_id)
        .single(),
    ])

    if (balanceData) {
      setActualBalance(balanceData.actualBalance)
      setReservedAmount(balanceData.reservedAmount)
      setAvailableBalance(balanceData.availableBalance)

      // helper returns activeReservations
      setActiveReservationCount(balanceData.activeReservations)
    }

    setTargetFloat(storeRes.data?.monthly_limit ?? 10000)
  }

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      const { data: cats } = await supabase
        .from('categories')
        .select('*')
        .order('name')

      setCategories(cats ?? [])
      await fetchTreasury()
    }

    fetchData()
  }, [user?.store_id])

  // ── Submission ─────────────────────────────────────────────────────────────
  const submit = async (values: FormValues, status: 'draft' | 'submitted') => {
    // Guard against duplicate submits from rapid clicks before React re-renders
    // the disabled button state.
    if (submitting || saving) return

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

      // Refresh treasury metrics immediately so the panel reflects the new
      // reservation before the success screen appears.
      if (status === 'submitted') {
        await fetchTreasury()
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

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
          <CheckCircle size={24} className="text-green-500" />
        </div>
        <p className="text-slate-700 font-medium">Expense submitted and liquidity reserved.</p>
        <p className="text-slate-400 text-sm mt-1">Redirecting...</p>
      </div>
    )
  }

  return (
    <form className="space-y-5">

      {/* ── Store Treasury Position panel ──────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200 text-sm">

        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Landmark size={13} className="text-slate-400 shrink-0" />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Store Treasury Position
            </span>
          </div>
          {/* Treasury health indicator */}
          <div className={`flex items-center gap-1.5 ${healthConfig[health].className}`}>
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${healthConfig[health].dotClass}`}
            />
            <span className="text-xs font-medium">{healthConfig[health].label}</span>
          </div>
        </div>

        {/* Available Balance — primary metric */}
        <div className="px-4 py-3">
          <p className="text-xs text-slate-400 mb-0.5">Available Balance</p>
          {availableBalance !== null ? (
            <p className={`text-xl font-semibold tracking-tight ${availableBalance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
              {formatCurrency(availableBalance)}
            </p>
          ) : (
            <p className="text-xl font-semibold text-slate-300 italic">Unavailable</p>
          )}
        </div>

        {/* Actual + Reserved sub-row */}
        <div className="flex divide-x divide-slate-200">
          <div className="flex-1 px-4 py-2.5">
            <p className="text-xs text-slate-400 mb-0.5">Actual Balance</p>
            {actualBalance !== null ? (
              <p className={`text-sm font-medium ${actualBalance < 0 ? 'text-red-500' : 'text-slate-700'}`}>
                {formatCurrency(actualBalance)}
              </p>
            ) : (
              <p className="text-sm font-medium text-slate-300 italic">—</p>
            )}
          </div>
          <div className="flex-1 px-4 py-2.5">
            <p className="text-xs text-slate-400 mb-0.5">Reserved</p>
            {reservedAmount !== null ? (
              <>
                <p className={`text-sm font-medium ${reservedAmount > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                  {formatCurrency(reservedAmount)}
                </p>
                {activeReservationCount !== null && activeReservationCount > 0 && (
                  <p className="text-xs text-amber-500 mt-0.5">
                    {activeReservationCount} pending {activeReservationCount === 1 ? 'expense' : 'expenses'}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm font-medium text-slate-300 italic">—</p>
            )}
          </div>
        </div>

        {/* Projected Available Balance (shown only when amount is entered) */}
        {watchedAmount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-slate-500 text-xs">Projected Available After Submission</span>
            {projectedAvailableBalance !== null ? (
              <span className={`text-sm font-medium ${projectedAvailableBalance < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {formatCurrency(projectedAvailableBalance)}
              </span>
            ) : (
              <span className="text-sm font-medium text-slate-300">—</span>
            )}
          </div>
        )}
      </div>

      {/* ── Category ────────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Category <span className="text-red-500">*</span>
        </label>
        <select
          {...register('category_id')}
          className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">Select a category</option>
          {categories.map((cat: Category) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        {errors.category_id && (
          <p className="text-xs text-red-500 mt-1">{errors.category_id.message}</p>
        )}
      </div>

      {/* ── Amount ──────────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Amount (₹) <span className="text-red-500">*</span>
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
          <p className="text-xs text-red-500 mt-1">{errors.amount.message}</p>
        )}

        {/* Negative available liquidity warning — does NOT block submission */}
        {wouldReduceLiquidity && (
          <div className="flex items-start gap-2 mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Projected available balance after this expense:{' '}
              <strong>{formatCurrency(projectedAvailableBalance)}</strong>.
              {' '}This expense may create negative available liquidity after approval.
              You can still submit.
            </p>
          </div>
        )}
      </div>

      {/* ── Description ─────────────────────────────────────────────────────── */}
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

      {/* ── Receipt ─────────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Receipt{' '}
          <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <ReceiptUpload
          value={receiptUrl}
          onChange={setReceiptUrl}
          onUploadingChange={setReceiptUploading}
          disabled={isSubmitDisabled}
        />
        {receiptUploading && (
          <p className="text-xs text-indigo-500 mt-1">
            Uploading receipt, please wait...
          </p>
        )}
      </div>

      {/* ── Error banner ────────────────────────────────────────────────────── */}
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

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          loading={saving}
          disabled={isSubmitDisabled}
          onClick={() => handleSubmit((v: FormValues) => submit(v, 'draft'))()}
        >
          {saving ? 'Saving...' : 'Save as Draft'}
        </Button>
        <Button
          type="button"
          className="flex-1"
          loading={submitting}
          disabled={isSubmitDisabled}
          onClick={() => handleSubmit((v: FormValues) => submit(v, 'submitted'))()}
        >
          {receiptUploading ? 'Uploading...' : submitting ? 'Submitting...' : 'Submit for Approval'}
        </Button>
      </div>
    </form>
  )
}