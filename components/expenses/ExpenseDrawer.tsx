'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import {
  X, ExternalLink, AlertTriangle, FileText, Download,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExpenseDetail {
  id:                     string
  amount:                 number
  status:                 string
  description:            string | null
  receipt_url:            string | null
  expense_month:          string
  rejection_reason:       string | null
  tally_sync_status:      string | null
  tally_voucher_id:       string | null
  created_at:             string
  updated_at:             string
  store: {
    id:            string
    name:          string
    cluster_name:  string
    monthly_limit: number
  } | null
  category:               { id: string; name: string } | null
  creator:                { id: string; name: string } | null
  cluster_approved_by:    string | null
  accounting_approved_by: string | null
}

export interface TimelineEntry {
  id:          string
  action:      string
  remarks:     string | null
  performedBy: string
  createdAt:   string
}

export interface FinancialContext {
  monthlyLimit:              number
  currentMonthSpend:         number
  currentMonthApprovedSpend: number
  actualBalance:             number | null
}

export interface RelatedExpense {
  id:            string
  amount:        number
  status:        string
  expense_month: string
  created_at:    string
  category_name: string | null
}

export interface DrawerData {
  expense:          ExpenseDetail
  timeline:         TimelineEntry[]
  financialContext: FinancialContext
  relatedExpenses:  RelatedExpense[]
}

export interface ExpenseDrawerProps {
  /** Expense UUID to load, or null to hide the drawer. */
  expenseId: string | null
  /** Called when the drawer should close (X button, backdrop, ESC). */
  onClose: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatMonth(isoDate: string): string {
  if (!isoDate) return '—'
  return new Date(isoDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

function formatDate(isoDate: string): string {
  if (!isoDate) return '—'
  return new Date(isoDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(isoDate: string): string {
  if (!isoDate) return '—'
  return new Date(isoDate).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const RAW_STATUS_LABELS: Record<string, string> = {
  draft:               'Draft',
  submitted:           'Submitted',
  cluster_approved:    'Cluster Approved',
  cluster_rejected:    'Cluster Rejected',
  accounting_approved: 'Accounting Approved',
  accounting_rejected: 'Accounting Rejected',
  approved:            'Approved',
  rejected:            'Rejected',
  synced_to_tally:     'Synced to Tally',
  tally_sync_failed:   'Tally Sync Failed',
}

const RAW_STATUS_CLASSES: Record<string, string> = {
  draft:               'bg-slate-100  text-slate-600   border-slate-200',
  submitted:           'bg-amber-50   text-amber-700   border-amber-200',
  cluster_approved:    'bg-teal-50    text-teal-700    border-teal-200',
  cluster_rejected:    'bg-red-50     text-red-700     border-red-200',
  accounting_approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accounting_rejected: 'bg-red-50     text-red-700     border-red-200',
  approved:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected:            'bg-red-50     text-red-700     border-red-200',
  synced_to_tally:     'bg-indigo-50  text-indigo-700  border-indigo-200',
  tally_sync_failed:   'bg-red-50     text-red-700     border-red-200',
}

export function rawStatusLabel(status: string): string {
  return RAW_STATUS_LABELS[status] ?? status
}

export function rawStatusClasses(status: string): string {
  return RAW_STATUS_CLASSES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'
}

function formatAuditAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Detect file type from the raw receipt_url (before proxying). */
export function getReceiptType(url: string): 'image' | 'pdf' | 'unknown' {
  const path = url.split('?')[0].toLowerCase()
  if (/\.(jpg|jpeg|png|webp)$/.test(path)) return 'image'
  if (/\.pdf$/.test(path)) return 'pdf'
  return 'unknown'
}

/** Extract a human-readable filename from a URL or bare path. */
export function getReceiptFilename(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'receipt')
  } catch {
    return url.split('/').pop()?.split('?')[0] || 'receipt'
  }
}

/**
 * Route any receipt_url value (bare storage path OR legacy full URL) through the
 * server-side signed-URL relay.  Mirrors exactly what ReceiptLink does.
 */
export function receiptProxyUrl(raw: string): string {
  return `/api/storage/receipt-url?url=${encodeURIComponent(raw)}`
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * Reusable Expense Detail Drawer.
 *
 * Drop-in for any page that renders expense rows. Pass the selected expense UUID
 * as `expenseId` and a close callback as `onClose`.  The component fetches its
 * own data, handles ESC / backdrop, and is self-contained.
 *
 * Requires the current user to have the `accounting` or `cluster_manager` role —
 * the API endpoint enforces this server-side.
 */
export function ExpenseDrawer({ expenseId, onClose }: ExpenseDrawerProps) {
  const [drawerData,      setDrawerData]      = useState<DrawerData | null>(null)
  const [drawerLoading,   setDrawerLoading]   = useState(false)
  const [receiptEnlarged, setReceiptEnlarged] = useState(false)

  // Internal override lets the user navigate to related expenses without the
  // parent needing to manage which expense is "active inside the drawer".
  const [overrideId, setOverrideId] = useState<string | null>(null)

  // Reset the override whenever the parent opens a different expense.
  useEffect(() => { setOverrideId(null) }, [expenseId])

  const activeId = overrideId ?? expenseId

  // ESC closes the drawer entirely.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetch detail whenever the active expense changes.
  useEffect(() => {
    setReceiptEnlarged(false)
    if (!activeId) { setDrawerData(null); return }
    let cancelled = false
    setDrawerLoading(true)
    fetch(`/api/accounting/expense-detail?id=${activeId}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (!cancelled && json) setDrawerData(json) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDrawerLoading(false) })
    return () => { cancelled = true }
  }, [activeId])

  if (!expenseId) return null

  return (
    <>
      {/* ── Backdrop ────────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* ── Drawer panel ────────────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 right-0 z-50 flex flex-col w-full sm:w-[580px] bg-white shadow-2xl border-l border-slate-200">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/60 flex-shrink-0">
          <div>
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-[0.18em]">
              Expense Detail
            </p>
            <p className="text-sm font-bold text-slate-800 mt-0.5 font-mono tracking-wide">
              #{(drawerData?.expense.id ?? activeId ?? '').substring(0, 8).toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Loading skeleton */}
          {drawerLoading && (
            <div className="p-5 space-y-4 animate-pulse">
              <div className="h-10 bg-slate-100 rounded-lg w-2/3" />
              <div className="grid grid-cols-2 gap-3">
                {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-lg" />)}
              </div>
              <div className="h-24 bg-slate-100 rounded-lg" />
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg" />)}
              </div>
            </div>
          )}

          {/* Error state */}
          {!drawerLoading && !drawerData && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
              <AlertTriangle size={32} className="text-slate-200" />
              <p className="text-sm font-medium">Could not load expense details.</p>
            </div>
          )}

          {/* Content */}
          {!drawerLoading && drawerData && (
            <div className="divide-y divide-slate-100">

              {/* ── Section 1: Expense Details ───────────────────────────────── */}
              <div className="px-5 py-5 space-y-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Expense Details
                </p>

                {/* Amount + Status */}
                <div className="flex items-start justify-between gap-4">
                  <p className="text-3xl font-extrabold text-slate-900 tabular-nums leading-none">
                    {formatCurrency(drawerData.expense.amount)}
                  </p>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border flex-shrink-0 ${rawStatusClasses(drawerData.expense.status)}`}>
                    {rawStatusLabel(drawerData.expense.status)}
                  </span>
                </div>

                {/* Detail grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Category</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {drawerData.expense.category?.name ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Expense Month</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {formatMonth(drawerData.expense.expense_month)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Store</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {drawerData.expense.store?.name ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cluster</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {drawerData.expense.store?.cluster_name ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Submitted By</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {drawerData.expense.creator?.name ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Created At</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {formatDateTime(drawerData.expense.created_at)}
                    </p>
                  </div>
                  {drawerData.expense.cluster_approved_by && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cluster Approver</p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5">
                        {drawerData.expense.cluster_approved_by}
                      </p>
                    </div>
                  )}
                  {drawerData.expense.accounting_approved_by && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Accounting Approver</p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5">
                        {drawerData.expense.accounting_approved_by}
                      </p>
                    </div>
                  )}
                  {drawerData.expense.tally_voucher_id && (
                    <div className="col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tally Voucher ID</p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 font-mono">
                        {drawerData.expense.tally_voucher_id}
                      </p>
                    </div>
                  )}
                </div>

                {/* Description */}
                {drawerData.expense.description && (
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Description</p>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {drawerData.expense.description}
                    </p>
                  </div>
                )}

                {/* Rejection reason */}
                {drawerData.expense.rejection_reason && (
                  <div className="flex gap-2.5 bg-red-50 border border-red-200 rounded-lg p-3">
                    <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Rejection Reason</p>
                      <p className="text-sm text-red-700 leading-relaxed">
                        {drawerData.expense.rejection_reason}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Section 2: Approval History ──────────────────────────────── */}
              <div className="px-5 py-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">
                  Approval History
                </p>
                {drawerData.timeline.length === 0 ? (
                  <p className="text-sm text-slate-400 font-medium">Approval history not available.</p>
                ) : (
                  <div>
                    {drawerData.timeline.map((entry, i) => {
                      const isLast     = i === drawerData.timeline.length - 1
                      const isApproved = entry.action.toLowerCase().includes('approved')
                      const isRejected = entry.action.toLowerCase().includes('rejected')
                      const dotColor   = isApproved
                        ? 'bg-emerald-500 ring-emerald-100'
                        : isRejected
                        ? 'bg-red-500 ring-red-100'
                        : 'bg-amber-400 ring-amber-100'
                      return (
                        <div key={entry.id} className="flex gap-3">
                          {/* Timeline spine */}
                          <div className="flex flex-col items-center flex-shrink-0">
                            <div className={`w-2.5 h-2.5 rounded-full mt-1 ring-4 ${dotColor}`} />
                            {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[24px]" />}
                          </div>
                          {/* Entry content */}
                          <div className="pb-4 min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800 leading-snug">
                              {formatAuditAction(entry.action)}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">by {entry.performedBy}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(entry.createdAt)}</p>
                            {entry.remarks && (
                              <p className="text-xs text-slate-500 mt-1.5 bg-slate-50 rounded px-2 py-1.5 leading-relaxed border border-slate-100">
                                {entry.remarks}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── Section 3: Receipt ───────────────────────────────────────── */}
              {(() => {
                const url = drawerData.expense.receipt_url
                const sectionHeader = (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Receipt</p>
                )

                if (!url) {
                  return (
                    <div className="px-5 py-5">
                      {sectionHeader}
                      <div className="flex flex-col items-center justify-center py-8 gap-2.5">
                        <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center">
                          <FileText size={20} className="text-slate-300" />
                        </div>
                        <p className="text-sm text-slate-400 font-medium">No receipt uploaded.</p>
                      </div>
                    </div>
                  )
                }

                const fileType = getReceiptType(url)
                const filename = getReceiptFilename(url)
                // All receipt URLs are routed through the server-side signed-URL relay.
                // This resolves bare storage paths AND legacy full URLs alike.
                const proxyUrl = receiptProxyUrl(url)

                return (
                  <div className="px-5 py-5">
                    {sectionHeader}

                    {/* Image */}
                    {fileType === 'image' && (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setReceiptEnlarged(true)}
                          title="Click to enlarge"
                          className="relative w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center min-h-[180px] group cursor-zoom-in"
                        >
                          <img
                            src={proxyUrl}
                            alt="Expense receipt"
                            className="max-w-full max-h-[280px] object-contain transition-opacity group-hover:opacity-90"
                            onError={e => {
                              const btn = e.currentTarget.closest('button') as HTMLButtonElement | null
                              if (btn) {
                                btn.innerHTML = `<p class="text-xs text-slate-400 p-6 text-center">Image preview unavailable</p>`
                                btn.style.cursor = 'default'
                              }
                            }}
                          />
                          <span className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] font-semibold px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            Click to enlarge
                          </span>
                        </button>
                        <a
                          href={proxyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          <ExternalLink size={14} />
                          Open in new tab
                        </a>
                      </div>
                    )}

                    {/* PDF */}
                    {fileType === 'pdf' && (
                      <div className="space-y-3">
                        <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                          <iframe
                            src={proxyUrl}
                            title="Receipt PDF"
                            className="w-full h-[420px] block"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={proxyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                          >
                            <ExternalLink size={13} />
                            Open PDF
                          </a>
                          <a
                            href={proxyUrl}
                            download={filename}
                            className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <Download size={13} />
                            Download
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Unknown file type */}
                    {fileType === 'unknown' && (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-3 px-4 py-4">
                          <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
                            <FileText size={18} className="text-slate-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{filename}</p>
                            <p className="text-xs text-slate-400 mt-0.5">Preview not available for this file type</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={proxyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors"
                          >
                            <ExternalLink size={13} />
                            Open file
                          </a>
                          <a
                            href={proxyUrl}
                            download={filename}
                            className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <Download size={13} />
                            Download
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── Section 4: Financial Context ─────────────────────────────── */}
              <div className="px-5 py-5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">
                  Financial Context — {drawerData.expense.store?.name ?? 'Store'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Monthly Limit</p>
                    <p className="text-base font-bold text-slate-900 tabular-nums mt-1">
                      {formatCurrency(drawerData.financialContext.monthlyLimit)}
                    </p>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Month Spend</p>
                    <p className={`text-base font-bold tabular-nums mt-1 ${
                      drawerData.financialContext.currentMonthSpend > drawerData.financialContext.monthlyLimit &&
                      drawerData.financialContext.monthlyLimit > 0
                        ? 'text-red-600'
                        : 'text-slate-900'
                    }`}>
                      {formatCurrency(drawerData.financialContext.currentMonthSpend)}
                    </p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Approved Spend</p>
                    <p className="text-base font-bold text-emerald-700 tabular-nums mt-1">
                      {formatCurrency(drawerData.financialContext.currentMonthApprovedSpend)}
                    </p>
                  </div>
                  <div className={`border rounded-xl p-3 ${
                    drawerData.financialContext.monthlyLimit > 0 &&
                    drawerData.financialContext.currentMonthSpend > drawerData.financialContext.monthlyLimit
                      ? 'bg-red-50 border-red-100'
                      : 'bg-slate-50 border-slate-100'
                  }`}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Remaining Budget</p>
                    {(() => {
                      const remaining = drawerData.financialContext.monthlyLimit - drawerData.financialContext.currentMonthSpend
                      return (
                        <p className={`text-base font-bold tabular-nums mt-1 ${remaining < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                          {formatCurrency(remaining)}
                        </p>
                      )
                    })()}
                  </div>
                  {drawerData.financialContext.actualBalance !== null && (
                    <div className="col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actual Cash Balance (Ledger)</p>
                      <p className={`text-base font-bold tabular-nums mt-1 ${
                        drawerData.financialContext.actualBalance < 0 ? 'text-red-600' : 'text-slate-900'
                      }`}>
                        {formatCurrency(drawerData.financialContext.actualBalance)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Section 5: Related Expenses ──────────────────────────────── */}
              <div className="px-5 py-5 pb-8">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Recent from {drawerData.expense.store?.name ?? 'This Store'}
                </p>
                {drawerData.relatedExpenses.length === 0 ? (
                  <p className="text-sm text-slate-400 font-medium">No other recent expenses from this store.</p>
                ) : (
                  <div className="space-y-1">
                    {drawerData.relatedExpenses.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setOverrideId(r.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-800 tabular-nums">
                              {formatCurrency(r.amount)}
                            </span>
                            {r.category_name && (
                              <span className="text-xs text-slate-400 truncate">{r.category_name}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatMonth(r.expense_month)} · {formatDate(r.created_at)}
                          </p>
                        </div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border flex-shrink-0 ${rawStatusClasses(r.status)}`}>
                          {rawStatusLabel(r.status)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </aside>

      {/* ── Image lightbox (z-[60] sits above the drawer's z-50) ─────────────── */}
      {receiptEnlarged && drawerData?.expense.receipt_url && (() => {
        const lightboxProxy = receiptProxyUrl(drawerData.expense.receipt_url)
        return (
          <div
            className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6"
            onClick={() => setReceiptEnlarged(false)}
          >
            <img
              src={lightboxProxy}
              alt="Receipt (enlarged)"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setReceiptEnlarged(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
            >
              <X size={20} />
            </button>
            <a
              href={lightboxProxy}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 h-8 px-3 text-sm font-semibold text-white bg-black/40 hover:bg-black/60 rounded-lg transition-colors"
            >
              <ExternalLink size={13} />
              Open in new tab
            </a>
          </div>
        )
      })()}
    </>
  )
}
