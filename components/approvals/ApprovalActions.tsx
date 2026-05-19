'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { useApprovals } from '@/lib/hooks/useApprovals'
import { getStoreBalance } from '@/lib/utils/getStoreBalance'
import type { Role } from '@/types'

interface ApprovalActionsProps {
  expenseId: string
  /** Store ID is required so we can fetch the current balance before accounting approval. */
  storeId: string
  /** The expense amount in the same currency unit as the ledger (e.g. paise or rupees). */
  expenseAmount: number
  userRole: Role
  onDone?: () => void
}

/**
 * Roles that perform the FINAL approval — both cluster managers (who finalise
 * the expense atomically) and accounting (supervisory) get the balance pre-check.
 */
const FINAL_APPROVAL_ROLES: Role[] = ['cluster_manager', 'accounting']

function isFinalApprovalRole(role: Role): boolean {
  return FINAL_APPROVAL_ROLES.includes(role)
}

/** Format a rupee amount, handling negatives cleanly. */
function formatINR(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = new Intl.NumberFormat('en-IN').format(abs)
  return amount < 0 ? `₹-${formatted}` : `₹${formatted}`
}

export function ApprovalActions({
  expenseId,
  storeId,
  expenseAmount,
  userRole,
  onDone,
}: ApprovalActionsProps) {
  const { approveExpense, rejectExpense } = useApprovals()

  // ── Rejection state ────────────────────────────────────────────────────────
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  // ── Approval state ─────────────────────────────────────────────────────────
  const [approving, setApproving] = useState(false)

  // ── Negative-balance warning state ─────────────────────────────────────────
  const [warnOpen, setWarnOpen] = useState(false)
  // null = balance fetch failed; number = confirmed ledger balance (may be 0 or negative)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)

  const [error, setError] = useState<string | null>(null)

  // ── Core approve action (runs after any warning is acknowledged) ────────────
  const executeApprove = async () => {
    setApproving(true)
    const { error: err } = await approveExpense(expenseId, userRole)
    setApproving(false)
    if (err) { setError(err); return }
    onDone?.()
  }

  // ── Primary approve handler ────────────────────────────────────────────────
  const handleApprove = async () => {
    setError(null)

    // Cluster managers and accounting both get the pre-approval balance check
    if (!isFinalApprovalRole(userRole)) {
      await executeApprove()
      return
    }

    // Fetch current store balance before approving
    setApproving(true)
    const balance = await getStoreBalance(storeId)
    setApproving(false)

    if (balance === null) {
      setError('Could not fetch store balance. Please try again.')
      return
    }

    const projectedBalance = balance - expenseAmount

    if (projectedBalance < 0) {
      // Surface warning — do NOT block
      setCurrentBalance(balance)
      setWarnOpen(true)
      return
    }

    // Balance stays non-negative — approve immediately
    await executeApprove()
  }

  // ── Approve anyway (from warning modal) ────────────────────────────────────
  const handleApproveAnyway = async () => {
    setWarnOpen(false)
    await executeApprove()
  }

  // ── Reject handler ─────────────────────────────────────────────────────────
  const handleReject = async () => {
    if (!reason.trim()) return
    setRejecting(true)
    const { error: err } = await rejectExpense(expenseId, userRole, reason)
    setRejecting(false)
    if (err) { setError(err); return }
    setRejectOpen(false)
    onDone?.()
  }

  // currentBalance is only null before the first fetch; the modal only opens
  // after a successful fetch sets it to a number, so this is safe.
  const projectedBalance = (currentBalance ?? 0) - expenseAmount

  return (
    <>
      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button
          size="sm"
          variant="danger"
          onClick={() => setRejectOpen(true)}
        >
          <XCircle size={14} />
          Reject
        </Button>

        <Button
          size="sm"
          loading={approving}
          onClick={handleApprove}
        >
          <CheckCircle size={14} />
          Approve
        </Button>
      </div>

      {/* ── Negative-balance warning modal (accounting only) ──────────────── */}
      <Modal
        open={warnOpen}
        onClose={() => setWarnOpen(false)}
        title="Balance Warning"
      >
        <div className="space-y-5">
          {/* Warning header */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" />
            <p className="text-sm text-amber-800">
              Approving this expense will result in a{' '}
              <span className="font-semibold">negative store balance</span>. You may still
              proceed — negative balances are permitted under the current petty cash policy.
            </p>
          </div>

          {/* Balance breakdown */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200 text-sm">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">Current Balance</span>
              {/* currentBalance is always set to a number before this modal opens */}
              <span className="font-medium text-slate-800">{formatINR(currentBalance ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">Expense Amount</span>
              <span className="font-medium text-slate-800">−{formatINR(expenseAmount)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-white rounded-b-lg">
              <span className="font-medium text-slate-700">Projected Balance</span>
              <span className="font-semibold text-red-600">{formatINR(projectedBalance)}</span>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            The ledger will reflect this negative balance immediately upon approval. Ensure
            a replenishment is scheduled if required.
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setWarnOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={approving}
              onClick={handleApproveAnyway}
            >
              Approve Anyway
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Rejection modal ───────────────────────────────────────────────── */}
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Expense"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Please provide a reason for rejection. This will be visible to the store manager.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Rejection Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Receipt is unclear, amount exceeds expected range..."
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={rejecting}
              disabled={!reason.trim()}
              onClick={handleReject}
            >
              Confirm Reject
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}