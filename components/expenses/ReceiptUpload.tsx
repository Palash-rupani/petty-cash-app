'use client'

import { useState, useRef } from 'react'
import { Upload, X, FileImage, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface ReceiptUploadProps {
  value?: string | null
  onChange: (url: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
  disabled?: boolean
}

export function ReceiptUpload({ value, onChange, onUploadingChange, disabled }: ReceiptUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const setUploadState = (state: boolean) => {
    setUploading(state)
    onUploadingChange?.(state)
  }

  const handleFile = async (file: File) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('File size must be under 5 MB'); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
      setError('Only JPG, PNG, WebP, or PDF files are allowed'); return
    }
    setUploadState(true); setError(null)
    try {
      const ext = file.name.split('.').pop()
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { data, error: uploadError } = await supabase.storage.from('receipts').upload(filename, file)
      if (uploadError) { setError(uploadError.message); return }
      // Store the bare storage path (not a public URL) so the signed URL relay
      // can always generate a fresh signed URL, regardless of bucket visibility.
      onChange(data.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploadState(false)
    }
  }

  // Always clears form value immediately; storage removal is best-effort
  const handleRemove = async () => {
    if (!value || removing || uploading) return
    setRemoving(true); setError(null)
    try {
      // Handle both storage formats:
      //   New: bare path   "1234-abc.jpg"
      //   Old: full URL    "https://…/object/public/receipts/1234-abc.jpg"
      const path = value.startsWith('http')
        ? (value.match(/\/receipts\/([^?]+)/)?.[1] ?? null)
        : value
      if (path) {
        const deletePromise = supabase.storage
          .from('receipts')
          .remove([path])

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Delete timeout')), 3000)
        )

        try {
          const { error } = await Promise.race([
            deletePromise,
            timeoutPromise,
          ]) as { error: Error | null }

          if (error) {
            console.error('Storage delete failed:', error)
          }
        } catch (err) {
          console.error('Storage delete timeout/error:', err)
        }
      }
    } catch { /* non-fatal — form state still cleared below */ } finally {

      onChange(null)
      onUploadingChange?.(false)
      setRemoving(false)

      if (inputRef.current) {
        inputRef.current.value = ''
      }
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
        <FileImage size={20} className="text-indigo-600 flex-shrink-0" />
        <a href={`/api/storage/receipt-url?url=${encodeURIComponent(value)}`}
          target="_blank" rel="noopener noreferrer"
          className="text-sm text-indigo-600 hover:underline truncate flex-1">
          View Receipt
        </a>
        {/* Remove button — visible regardless of form disabled state */}
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing || uploading}
          className="p-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Remove receipt"
        >
          {removing ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => { if (!disabled && !uploading) inputRef.current?.click() }}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ` +
          (disabled || uploading ? 'opacity-50 cursor-not-allowed border-slate-200' : 'border-slate-300 hover:border-indigo-400 cursor-pointer')}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-indigo-600">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-sm font-medium">Uploading receipt...</p>
            <p className="text-xs text-slate-400">Please wait, do not close this page</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <Upload size={24} />
            <p className="text-sm"><span className="text-indigo-600 font-medium">Click to upload</span>{' '}or drag and drop</p>
            <p className="text-xs">JPG, PNG, PDF up to 5 MB (optional)</p>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden" disabled={disabled || uploading}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      {error && (
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs text-red-500">{error}</p>
          <button type="button" onClick={() => { setError(null); inputRef.current?.click() }}
            className="text-xs text-indigo-600 hover:underline ml-2">Retry</button>
        </div>
      )}
    </div>
  )
}