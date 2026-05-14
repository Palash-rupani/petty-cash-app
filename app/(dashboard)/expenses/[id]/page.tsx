'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { useToast } from '@/components/ui/Toast'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ReceiptUpload } from '@/components/expenses/ReceiptUpload'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { format } from 'date-fns'
import {
  ArrowLeft, Paperclip, AlertTriangle, Clock,
  Edit2, Trash2, Send,
} from 'lucide-react'
import type { Category, Expense, AuditLog } from '@/types'

// ─── Edit form schema ─────────────────────────────────────────────────────────

const editSchema = z.object({
  category_id: z.string().min(1, 'Category is required'),
  amount: z.coerce.number().positive('Amount must be positive'),
  description: z.string().optional(),
})
type EditValues = z.infer<typeof editSchema>

// ─── Page ─────────────────────────────────────────────────────────────────────

type PageMode = 'view' | 'edit'

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [expense, setExpense] = useState<Expense | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<PageMode>('view')

  // Action states
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // Edit form receipt state
  const [editReceiptUrl, setEditReceiptUrl] = useState<string | null>(null)
  const [receiptUploading, setReceiptUploading] = useState(false)

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<EditValues>({ resolver: zodResolver(editSchema) as any })

  // ─── Fetch expense + audit logs ──────────────────────────────────────────

  const fetchExpense = async () => {
    const { data } = await supabase
      .from('expenses')
      .select(`
        *,
        store:stores(id, name, monthly_limit),
        category:categories(id, name),
        creator:users!expenses_created_by_fkey(id, name, email)
      `)
      .eq('id', id)
      .single()

    setExpense(data as Expense | null)

    const { data: logs } = await supabase
      .from('audit_logs')
      .select('*, performer:users!audit_logs_performed_by_fkey(id, name)')
      .eq('expense_id', id)
      .order('created_at', { ascending: true })

    setAuditLogs((logs as AuditLog[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    const fetchCategories = async () => {
      const { data } = await supabase.from('categories').select('*').order('name')
      setCategories(data ?? [])
    }
    if (id) { fetchExpense(); fetchCategories() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ─── Guard helpers ───────────────────────────────────────────────────────

  const isDraft = expense?.status === 'draft'
  const isOwner = expense?.created_by === user?.id
  const isStoreManager = user?.role === 'store_manager'
  const canAct = isDraft && isOwner && isStoreManager

  // ─── Submit for approval ─────────────────────────────────────────────────

  const handleSubmitForApproval = async () => {
    if (!expense || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'submitted' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(body.error ?? 'Failed to submit expense', 'error')
        return
      }
      const updated = await res.json()
      setExpense(updated)
      toast('Expense submitted for approval!', 'success')
    } catch {
      toast('Something went wrong. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Enter edit mode ──────────────────────────────────────────────────────

  const enterEditMode = () => {
    if (!expense) return
    resetForm({
      category_id: expense.category_id,
      amount: expense.amount,
      description: expense.description ?? '',
    })
    setEditReceiptUrl(expense.receipt_url ?? null)
    setMode('edit')
  }

  // ─── Save draft edits ─────────────────────────────────────────────────────

  const handleSaveEdit = async (values: EditValues) => {
    if (!expense || saving) return
    if (receiptUploading) { toast('Please wait for the receipt to finish uploading.', 'info'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: values.category_id,
          amount: values.amount,
          description: values.description ?? null,
          receipt_url: editReceiptUrl,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(body.error ?? 'Failed to save changes', 'error')
        return
      }
      const updated = await res.json()
      setExpense(updated)
      setMode('view')
      toast('Draft saved successfully!', 'success')
    } catch {
      toast('Something went wrong. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ─── Delete draft ─────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!expense || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(body.error ?? 'Failed to delete expense', 'error')
        setShowDeleteModal(false)
        return
      }
      toast('Expense draft deleted.', 'success')
      router.push('/expenses')
      router.refresh() // invalidate router cache so list re-fetches and deleted expense disappears
    } catch {
      toast('Something went wrong. Please try again.', 'error')
    } finally {
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  // ─── Loading skeleton ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    )
  }

  if (!expense) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400">Expense not found</p>
        <Button variant="ghost" onClick={() => router.back()} className="mt-3">Go back</Button>
      </div>
    )
  }

  const isRejected = expense.status.includes('rejected')

  // ─── EDIT MODE ────────────────────────────────────────────────────────────

  if (mode === 'edit') {
    return (
      <div className="max-w-2xl space-y-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode('view')} className="text-slate-500">
          <ArrowLeft size={16} /> Cancel Edit
        </Button>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-slate-800">Edit Draft</h2>
            <p className="text-sm text-slate-500 mt-0.5">Update your expense details below.</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit(handleSaveEdit)}>
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  {...register('category_id')}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select a category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                {errors.category_id && <p className="text-xs text-red-500 mt-1">{errors.category_id.message}</p>}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Amount (₹) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">₹</span>
                  <input
                    type="number" step="0.01" min="0"
                    {...register('amount')}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount.message}</p>}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
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
                  Receipt <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <ReceiptUpload
                  key={editReceiptUrl ?? '__empty__'}
                  value={editReceiptUrl}
                  onChange={setEditReceiptUrl}
                  onUploadingChange={setReceiptUploading}
                  disabled={saving}
                />
                {receiptUploading && (
                  <p className="text-xs text-indigo-500 mt-1">Uploading receipt, please wait...</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setMode('view')} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" loading={saving} disabled={saving || receiptUploading}>
                  {receiptUploading ? 'Uploading...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── VIEW MODE ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl space-y-4">
      <Button type="button" variant="ghost" size="sm" onClick={() => router.back()} className="text-slate-500">
        <ArrowLeft size={16} /> Back
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                {expense.category?.name ?? 'Expense'}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {expense.store?.name ?? ''} · {format(new Date(expense.created_at), 'd MMM yyyy')}
              </p>
            </div>
            <Badge status={expense.status} />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Rejection reason */}
          {isRejected && expense.rejection_reason && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700">Rejection Reason</p>
                <p className="text-sm text-red-600 mt-0.5">{expense.rejection_reason}</p>
                <p className="text-xs text-red-400 mt-1">To resubmit, please create a new expense.</p>
              </div>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Amount</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{formatCurrency(expense.amount)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Month</p>
              <p className="text-sm text-slate-700 mt-1">{format(new Date(expense.expense_month), 'MMMM yyyy')}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Category</p>
              <p className="text-sm text-slate-700 mt-1">{expense.category?.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Submitted by</p>
              <p className="text-sm text-slate-700 mt-1">{expense.creator?.name ?? '—'}</p>
            </div>
          </div>

          {expense.description && (
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Description</p>
              <p className="text-sm text-slate-700 mt-1">{expense.description}</p>
            </div>
          )}

          {expense.receipt_url && (
            <div>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-1">Receipt</p>
              <a
                href={expense.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <Paperclip size={14} /> View Receipt
              </a>
            </div>
          )}

          {/* Draft action buttons */}
          {canAct && (
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <p className="text-xs text-slate-400">
                This draft is only visible to you. Submit it to send for approval.
              </p>
              <div className="flex flex-wrap gap-2">
                {/* Submit for Approval */}
                <Button
                  type="button"
                  size="sm"
                  loading={submitting}
                  disabled={submitting || saving || deleting}
                  onClick={handleSubmitForApproval}
                >
                  <Send size={14} />
                  Submit for Approval
                </Button>

                {/* Edit Draft */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submitting || saving || deleting}
                  onClick={enterEditMode}
                >
                  <Edit2 size={14} />
                  Edit Draft
                </Button>

                {/* Delete Draft */}
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  loading={deleting}
                  disabled={submitting || saving || deleting}
                  onClick={() => setShowDeleteModal(true)}
                >
                  <Trash2 size={14} />
                  Delete Draft
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      {auditLogs.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-slate-800">Activity History</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3">
                  <div className="mt-0.5 p-1 bg-slate-100 rounded-full flex-shrink-0">
                    <Clock size={11} className="text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">
                      <span className="font-medium">
                        {(log.performer as { name: string } | null)?.name ?? 'System'}
                      </span>{' '}
                      {log.action.replace(/_/g, ' ')}
                    </p>
                    {log.remarks && <p className="text-xs text-slate-400 mt-0.5">{log.remarks}</p>}
                    <p className="text-xs text-slate-300 mt-0.5">
                      {format(new Date(log.created_at), 'd MMM yyyy, h:mm a')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => { if (!deleting) setShowDeleteModal(false) }}
        title="Delete Expense Draft"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">This action cannot be undone</p>
              <p className="text-sm text-red-600 mt-0.5">
                You are about to permanently delete the draft expense for{' '}
                <strong>{expense.category?.name}</strong> —{' '}
                <strong>{formatCurrency(expense.amount)}</strong>.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              loading={deleting}
              disabled={deleting}
              onClick={handleDelete}
            >
              Delete Draft
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
