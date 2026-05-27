import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()

  // 1. Authenticate
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Admin only
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
  }

  // 3. Trigger GitHub Actions workflow_dispatch
  const owner = process.env.GITHUB_OWNER
  const repo  = process.env.GITHUB_REPO
  const token = process.env.GITHUB_TOKEN

  if (!owner || !repo || !token) {
    return NextResponse.json(
      { error: 'GitHub configuration missing. Check GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN.' },
      { status: 500 }
    )
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/process-reports.yml/dispatches`

  const ghRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  })

  // GitHub returns 204 No Content on success
  if (!ghRes.ok) {
    const text = await ghRes.text()
    return NextResponse.json(
      { error: `GitHub API error (${ghRes.status}): ${text}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
