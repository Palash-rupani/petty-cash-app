'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react'

import { useApprovals } from '@/lib/hooks/useApprovals'
import { getAvailableBalance } from '@/lib/finance/getAvailableBalance'

import type { Role } from '@/types'

interface ApprovalActionsProps {
  expenseId: string
  storeId: string
  expenseAmount: number
  userRole: Role
  onDone?: () => void
}

/**
 * Cluster managers are now the ONLY
 * operational treasury approvers.
 */
const FINAL_APPROVAL_ROLES = ['cluster_manager']

function isFinalApprovalRole(role: Role): boolean {
  return FINAL_APPROVAL_ROLES.includes(role)
}

/** Format INR cleanly */
function formatINR(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = new Intl.NumberFormat('en-IN').format(abs)

  return amount < 0
    ? `₹-${formatted}`
    : `₹${formatted}`
}

export function ApprovalActions({
  expenseId,
  storeId,
  expenseAmount,
  userRole,
  onDone,
}: ApprovalActionsProps) {

  const {
    approveExpense,
    rejectExpense,
  } = useApprovals()

  // ── Reject state ────────────────────────────────────────────────────────
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  // ── Approve state ───────────────────────────────────────────────────────
  const [approving, setApproving] = useState(false)

  // ── Liquidity warning state ─────────────────────────────────────────────
  const [warnOpen, setWarnOpen] = useState(false)

  /**
   * Available liquidity before approval.
   * null = failed fetch
   */
  const [availableBalance, setAvailableBalance] =
    useState<number | null>(null)

  const [error, setError] =
    useState<string | null>(null)

  // ────────────────────────────────────────────────────────────────────────
  // Execute approve
  // ────────────────────────────────────────────────────────────────────────
  const executeApprove = async () => {

    setApproving(true)

    const { error: err } =
      await approveExpense(
        expenseId,
        userRole
      )

    setApproving(false)

    if (err) {
      setError(err)
      return
    }

    onDone?.()
  }

  // ────────────────────────────────────────────────────────────────────────
  // Main approve handler
  // ────────────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    // Guard: block duplicate calls while any action is already in flight.
    if (approving || rejecting) return

    setError(null)

    /**
     * Only cluster managers perform
     * final treasury execution.
     */
    if (!isFinalApprovalRole(userRole)) {
      await executeApprove()
      return
    }

    setApproving(true)

    const treasury =
      await getAvailableBalance(storeId)

    setApproving(false)

    if (!treasury) {
      setError(
        'Could not fetch treasury position. Please try again.'
      )
      return
    }

    const balance =
      treasury.availableBalance

    setAvailableBalance(balance)

    const projectedAvailable =
      balance - expenseAmount

    /**
     * Negative available liquidity warning.
     * Do NOT block approval.
     */
    if (projectedAvailable < 0) {
      setWarnOpen(true)
      return
    }

    await executeApprove()
  }

  // ────────────────────────────────────────────────────────────────────────
  // Approve anyway
  // ────────────────────────────────────────────────────────────────────────
  const handleApproveAnyway = async () => {
    // Guard: rapid double-click on "Approve Anyway" before modal closes.
    if (approving || rejecting) return

    setWarnOpen(false)

    await executeApprove()
  }

  // ────────────────────────────────────────────────────────────────────────
  // Reject handler
  // ────────────────────────────────────────────────────────────────────────
  const handleReject = async () => {
    // Guard: block duplicate rejection calls from rapid clicks.
    if (rejecting) return

    if (!reason.trim()) return

    setRejecting(true)

    const { error: err } =
      await rejectExpense(
        expenseId,
        userRole,
        reason
      )

    setRejecting(false)

    if (err) {
      setError(err)
      return
    }

    setRejectOpen(false)

    onDone?.()
  }

  const projectedAvailable =
    (availableBalance ?? 0) - expenseAmount

  return (
    <>
      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">

        {error && (
          <p className="text-xs text-red-500">
            {error}
          </p>
        )}

        <Button
          size="sm"
          variant="danger"
          disabled={approving || rejecting}
          onClick={() => setRejectOpen(true)}
        >
          <XCircle size={14} />
          Reject
        </Button>

        <Button
          size="sm"
          loading={approving}
          disabled={approving || rejecting}
          onClick={handleApprove}
        >
          <CheckCircle size={14} />
          {approving ? 'Approving...' : 'Approve'}
        </Button>
      </div>

      {/* ── Negative liquidity warning ───────────────────────────────── */}
      <Modal
        open={warnOpen}
        onClose={() => setWarnOpen(false)}
        title="Liquidity Warning"
      >
        <div className="space-y-5">

          {/* Warning banner */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">

            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0 text-amber-500"
            />

            <p className="text-sm text-amber-800">
              Approving this expense will result in
              <span className="font-semibold">
                {' '}negative available liquidity
              </span>.
              You may still proceed under the current treasury policy.
            </p>
          </div>

          {/* Treasury breakdown */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200 text-sm">

            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">
                Available Balance
              </span>

              <span className="font-medium text-slate-800">
                {formatINR(availableBalance ?? 0)}
              </span>
            </div>

            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-slate-500">
                Expense Amount
              </span>

              <span className="font-medium text-slate-800">
                −{formatINR(expenseAmount)}
              </span>
            </div>

            <div className="flex items-center justify-between px-4 py-2.5 bg-white rounded-b-lg">

              <span className="font-medium text-slate-700">
                Projected Available Balance
              </span>

              <span className="font-semibold text-red-600">
                {formatINR(projectedAvailable)}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            This approval will reduce available liquidity below zero.
            Ensure replenishment is scheduled if operationally required.
          </p>

          {/* Actions */}
          <div className="flex gap-3">

            <Button
              variant="ghost"
              className="flex-1"
              disabled={approving}
              onClick={() => setWarnOpen(false)}
            >
              Cancel
            </Button>

            <Button
              className="flex-1"
              loading={approving}
              disabled={approving}
              onClick={handleApproveAnyway}
            >
              {approving ? 'Approving...' : 'Approve Anyway'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Reject modal ─────────────────────────────────────────────── */}
      <Modal
        open={rejectOpen}
        onClose={() => { if (!rejecting) setRejectOpen(false) }}
        title="Reject Expense"
      >
        <div className="space-y-4">

          <p className="text-sm text-slate-600">
            Please provide a rejection reason.
            This will be visible to the store manager.
          </p>

          <div>

            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Rejection Reason
              <span className="text-red-500">
                {' '}*
              </span>
            </label>

            <textarea
              rows={4}
              value={reason}
              onChange={(e) =>
                setReason(e.target.value)
              }
              placeholder="e.g. Receipt unclear, unsupported expense..."
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
          </div>

          <div className="flex gap-3">

            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </Button>

            <Button
              variant="danger"
              className="flex-1"
              loading={rejecting}
              disabled={!reason.trim() || rejecting}
              onClick={handleReject}
            >
              {rejecting ? 'Rejecting...' : 'Confirm Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}