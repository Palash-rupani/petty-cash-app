'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'

export default function ReportUploadPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [selectedType, setSelectedType] = useState('')
  const [file, setFile] = useState<File | null>(null)
  
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [isProcessing, setIsProcessing] = useState(false)
  const [processError, setProcessError] = useState<string | null>(null)
  const [processSuccess, setProcessSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.replace('/')
    }
  }, [loading, user, router])

  const handleUpload = async () => {
    // Guard: block duplicate uploads from rapid clicks before React re-renders
    // the disabled button state.
    if (isUploading) return

    if (!selectedType || !file) return

    setIsUploading(true)
    setError(null)
    setSuccess(null)

    const formData = new FormData()
    formData.append('reportType', selectedType)
    formData.append('file', file)

    try {
      const res = await fetch('/api/reports/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'An error occurred during upload')
        return
      }

      setSuccess('Report uploaded successfully!')
      setFile(null)
      // Reset file input visually
      const fileInput = document.getElementById('file-input') as HTMLInputElement
      if (fileInput) {
        fileInput.value = ''
      }
    } catch (err) {
      setError('Network error or unexpected failure')
    } finally {
      setIsUploading(false)
    }
  }

  const handleProcess = async () => {
    // Guard: block duplicate triggers before React re-renders the disabled state.
    if (isProcessing) return

    setIsProcessing(true)
    setProcessError(null)
    setProcessSuccess(null)

    try {
      const res = await fetch('/api/reports/process', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setProcessError(data.error || 'Failed to trigger processing workflow.')
        return
      }

      setProcessSuccess('Processing workflow triggered. GitHub Actions is now running.')
    } catch {
      setProcessError('Network error — could not reach the server.')
    } finally {
      setIsProcessing(false)
    }
  }

  if (loading || !user || user.role !== 'admin') {
    return null
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Reports Upload</h1>
        <p className="text-sm text-slate-500">
          Upload operational reports for processing. Admin access only.
        </p>
      </div>

      {/* ── Upload card ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="space-y-6 max-w-md">
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}
          
          {success && (
            <div className="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg">
              {success}
            </div>
          )}

          {/* Report Type */}
          <div className="space-y-2">
            <label htmlFor="report-type" className="block text-sm font-medium text-slate-700">
              Report Type
            </label>
            <select
              id="report-type"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
              disabled={isUploading}
            >
              <option value="" disabled>Select report type...</option>
              <option value="sales">Sales</option>
              <option value="stock">Stock</option>
              <option value="GRN">GRN</option>
              <option value="salesperson">Salesperson</option>
            </select>
          </div>

          {/* File Input */}
          <div className="space-y-2">
            <label htmlFor="file-input" className="block text-sm font-medium text-slate-700">
              Excel / CSV File
            </label>
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-colors disabled:opacity-50"
              disabled={isUploading}
            />
          </div>

          {/* Upload Button */}
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedType || !file || isUploading}
            className="w-full h-10 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isUploading ? 'Uploading...' : 'Upload Report'}
          </button>
        </div>
      </div>
      {/* ── Run Processing card ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="space-y-4 max-w-md">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Run Processing</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Trigger the GitHub Actions ETL workflow to process all pending reports.
            </p>
          </div>

          {processError && (
            <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {processError}
            </div>
          )}

          {processSuccess && (
            <div className="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg">
              {processSuccess}
            </div>
          )}

          <button
            type="button"
            onClick={handleProcess}
            disabled={isProcessing}
            className="w-full h-10 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Run Processing'}
          </button>
        </div>
      </div>
    </div>
  )
}
