import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const supabase = await createClient()

    // 1. Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Verify role === 'admin'
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    // Parse form data
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const reportType = formData.get('reportType') as string | null

    // 3. Validate inputs
    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }
    
    if (!reportType || !['sales', 'stock', 'GRN', 'salesperson'].includes(reportType)) {
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
    }

    // Validate file size (50MB)
    const MAX_SIZE = 50 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 })
    }

    // Validate file extension
    const filename = file.name
    const ext = filename.split('.').pop()?.toLowerCase()
    if (!ext || !['xlsx', 'xls', 'csv'].includes(ext)) {
      return NextResponse.json({ error: 'Invalid file type. Only .xlsx, .xls, and .csv are allowed' }, { status: 400 })
    }

    // Compute SHA-256 hash of file bytes for deduplication
    const bytes = await file.arrayBuffer()
    const fileHash = createHash('sha256').update(Buffer.from(bytes)).digest('hex')

    // Reject if an identical file was already uploaded
    const { data: existingUpload } = await supabase
      .from('uploaded_reports')
      .select('id')
      .eq('file_hash', fileHash)
      .maybeSingle()

    if (existingUpload) {
      return NextResponse.json(
        { error: 'This report was already uploaded.' },
        { status: 409 }
      )
    }

    // Generate timestamp
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    const yyyy = now.getFullYear()
    const mm = pad(now.getMonth() + 1)
    const dd = pad(now.getDate())
    const HH = pad(now.getHours())
    const MM = pad(now.getMinutes())
    const SS = pad(now.getSeconds())
    const timestamp = `${yyyy}_${mm}_${dd}_${HH}${MM}${SS}`

    // Generate storage path: raw/<reportType>/<reportType>_<timestamp>.<ext>
    const storagePath = `raw/${reportType}/${reportType}_${timestamp}.${ext}`

    // 4. Upload to Supabase Storage (use pre-read bytes so we don't re-read the body)
    const { error: uploadError } = await supabase.storage
      .from('retail-ops')
      .upload(storagePath, bytes, {
        cacheControl: '3600',
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 })
    }

    // 5. Insert uploaded_reports row (file_hash stored for future dedup checks)
    const { error: dbError } = await supabase
      .from('uploaded_reports')
      .insert({
        report_type: reportType,
        original_filename: filename,
        storage_path: storagePath,
        uploaded_by: user.id,
        processing_status: 'pending',
        file_hash: fileHash,
      })

    if (dbError) {
      console.error('Database insert error:', dbError)
      // Cleanup storage if db insert fails
      await supabase.storage.from('retail-ops').remove([storagePath])
      return NextResponse.json({ error: 'Failed to record upload in database' }, { status: 500 })
    }

    // 6. Return JSON response
    return NextResponse.json({ 
      success: true, 
      message: 'Report uploaded successfully',
      data: {
        report_type: reportType,
        storage_path: storagePath
      }
    }, { status: 200 })

  } catch (error) {
    console.error('Unexpected upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
