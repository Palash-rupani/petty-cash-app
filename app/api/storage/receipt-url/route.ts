import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Extracts the bare storage object path from whatever format receipt_url was
 * stored as.  Handles three cases:
 *
 *  1. New uploads (path only):  "1234-abc.jpg"
 *  2. Public URL (legacy):      "https://…/object/public/receipts/1234-abc.jpg"
 *  3. Signed URL (legacy):      "https://…/object/sign/receipts/1234-abc.jpg?token=JWT"
 *
 * In all cases we want the bare filename returned to storage.from().createSignedUrl().
 */
function extractStoragePath(raw: string): string | null {
  // Already a bare path — no slash, no scheme
  if (!raw.startsWith('http')) return raw

  // Pull everything between /receipts/ and the next ? or end-of-string
  const match = raw.match(/\/receipts\/([^?]+)/)
  return match?.[1] ?? null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('url') ?? searchParams.get('path')

  if (!raw) {
    return NextResponse.json({ error: 'url or path parameter required' }, { status: 400 })
  }

  // Auth guard — every receipt view must be authenticated
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const storagePath = extractStoragePath(raw)
  if (!storagePath) {
    return NextResponse.json({ error: 'Could not parse storage path from URL' }, { status: 400 })
  }

  // 1-hour signed URL — long enough for a review session, short enough to limit
  // exposure if the link leaks.
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(storagePath, 3600)

  if (error || !data?.signedUrl) {
    console.error('[GET /api/storage/receipt-url]', error)
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })
  }

  // Redirect so the browser fetches the file directly from Supabase CDN.
  // This keeps the signed URL out of client-side JavaScript.
  return NextResponse.redirect(data.signedUrl)
}
