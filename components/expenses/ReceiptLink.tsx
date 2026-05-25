'use client'

import { ExternalLink, Paperclip } from 'lucide-react'

interface ReceiptLinkProps {
  url: string | null | undefined
  /** Render a paperclip icon only (for table cells). Default: false (text + icon). */
  iconOnly?: boolean
  className?: string
}

/**
 * Renders a receipt link that always routes through the server-side signed URL
 * relay (/api/storage/receipt-url).  Works with both legacy public-URL records
 * and new path-only records stored after the private-bucket migration.
 */
export function ReceiptLink({ url, iconOnly = false, className }: ReceiptLinkProps) {
  if (!url) return null

  const href = `/api/storage/receipt-url?url=${encodeURIComponent(url)}`

  if (iconOnly) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className ?? 'text-indigo-600 hover:text-indigo-700'}
        title="View receipt"
      >
        <Paperclip size={14} className="mx-auto" />
      </a>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        'inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium transition-colors'
      }
    >
      View <ExternalLink className="w-3 h-3" />
    </a>
  )
}
