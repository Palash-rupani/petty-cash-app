'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { Card } from '@/components/ui/Card'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProcessingStatus = 'pending' | 'processing' | 'processed' | 'failed'

interface UploadedReport {
  id: string
  report_type: string
  original_filename: string
  storage_path: string
  processing_status: string
  uploaded_at: string
  uploader: { name: string }[] | null
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ProcessingStatus,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  pending: {
    label: 'Pending',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
  },
  processing: {
    label: 'Processing',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-400',
  },
  processed: {
    label: 'Processed',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-400',
  },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as ProcessingStatus] ?? {
    // Fallback for unexpected status values
    label: status,
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportHistoryPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const supabase = createClient()

  const [reports, setReports] = useState<UploadedReport[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Redirect non-admins — same pattern as the upload page
  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.replace('/')
    }
  }, [loading, user, router])

  // Fetch all uploaded_reports ordered newest-first
  useEffect(() => {
    if (!user || user.role !== 'admin') return

    const fetchReports = async () => {
      setFetching(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('uploaded_reports')
        .select(
          'id, report_type, original_filename, storage_path, processing_status, uploaded_at, uploader:users!uploaded_by(name)'
        )
        .order('uploaded_at', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
      } else {
        setReports((data ?? []) as UploadedReport[])
      }

      setFetching(false)
    }

    fetchReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Show nothing while auth resolves or if access is denied
  if (loading || !user || user.role !== 'admin') {
    return null
  }

  return (
    <div className="max-w-6xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Upload History</h1>
        <p className="text-sm text-slate-500 mt-1">
          All uploaded reports and their current processing state.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Table card */}
      <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">

        {fetching ? (
          /* Loading skeleton — matches the app's animate-pulse convention */
          <div className="divide-y divide-slate-50">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-5 w-16 bg-slate-100 rounded-full" />
                <div className="h-4 w-48 bg-slate-100 rounded" />
                <div className="h-4 w-28 bg-slate-100 rounded" />
                <div className="h-4 w-32 bg-slate-100 rounded" />
                <div className="h-5 w-20 bg-slate-100 rounded-full" />
                <div className="h-4 flex-1 bg-slate-100 rounded" />
              </div>
            ))}
          </div>

        ) : reports.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <FileSpreadsheet className="w-5 h-5 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">No reports uploaded yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Uploaded reports will appear here once the first file is submitted.
            </p>
          </div>

        ) : (
          /* Data table */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 whitespace-nowrap">
                    Report Type
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 whitespace-nowrap">
                    Original Filename
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 whitespace-nowrap">
                    Uploaded By
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 whitespace-nowrap">
                    Uploaded At
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 whitespace-nowrap">
                    Processing Status
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 px-6 py-3 whitespace-nowrap">
                    Storage Path
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report, i) => (
                  <tr
                    key={report.id}
                    className={`border-b border-slate-50 last:border-0 transition-colors hover:bg-slate-50/60 ${
                      i % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'
                    }`}
                  >
                    {/* Report Type — pill badge so it reads at a glance */}
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold capitalize">
                        {report.report_type}
                      </span>
                    </td>

                    {/* Original Filename — truncated with full name in title for hover */}
                    <td className="px-6 py-3.5 max-w-[200px]">
                      <span
                        className="block truncate font-medium text-slate-700"
                        title={report.original_filename}
                      >
                        {report.original_filename}
                      </span>
                    </td>

                    {/* Uploaded By */}
                    <td className="px-6 py-3.5 text-slate-600 whitespace-nowrap">
                      {report.uploader?.[0]?.name ?? '—'}
                    </td>

                    {/* Uploaded At */}
                    <td className="px-6 py-3.5 text-slate-500 whitespace-nowrap tabular-nums">
                      {format(new Date(report.uploaded_at), 'd MMM yyyy, h:mm a')}
                    </td>

                    {/* Processing Status */}
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      <StatusBadge status={report.processing_status} />
                    </td>

                    {/* Storage Path — monospace, truncated, full path on hover */}
                    <td className="px-6 py-3.5 max-w-[220px]">
                      <span
                        className="block truncate font-mono text-xs text-slate-400"
                        title={report.storage_path}
                      >
                        {report.storage_path}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Row count footer */}
      {!fetching && (
        <p className="text-xs text-slate-400">
          {reports.length} report{reports.length !== 1 ? 's' : ''} total
        </p>
      )}

    </div>
  )
}
