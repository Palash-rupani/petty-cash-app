'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CheckCircle, XCircle } from 'lucide-react'
import { useApprovals } from '@/lib/hooks/useApprovals'
import type { Role } from '@/types'

interface ApprovalActionsProps {
  expenseId: string
  userRole: Role
  onDone?: () => void
}

export function ApprovalActions({ expenseId, userRole, onDone }: ApprovalActionsProps) {
  const { approveExpense, rejectExpense } = useApprovals()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleApprove = async () => {
    setApproving(true)
    const { error: err } = await approveExpense(expenseId, userRole)
    setApproving(false)
    if (err) { setError(err); return }
    onDone?.()
  }

  const handleReject = async () => {
    if (!reason.trim()) return
    setRejecting(true)
    const { error: err } = await rejectExpense(expenseId, userRole, reason)
    setRejecting(false)
    if (err) { setError(err); return }
    setRejectOpen(false)
    onDone?.()
  }

  return (
    <>
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
