import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ─── POST /api/treasury/cluster-topup ────────────────────────────────────────
//
// Secure server-side execution layer for cluster manager treasury top-ups.
//
// All business-rule validation (role, cluster ownership, amount) is enforced
// inside the create_cluster_topup() Supabase RPC, which runs as SECURITY
// DEFINER. This route is a thin, authenticated transport layer only.
//
// Request body:
//   { store_id: string, amount: number, remarks?: string }
//
// Response:
//   200  { success: true }
//   400  { error: string }   — validation failure
//   401  { error: string }   — unauthenticated
//   403  { error: string }   — role / cluster scope violation
//   404  { error: string }   — store not found
//   500  { error: string }   — unexpected failure
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
    const supabase = await createClient()

    // ── Auth check ─────────────────────────────────────────────────────────────
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json(
            { error: 'Unauthorized treasury operation' },
            { status: 401 }
        )
    }

    // ── Parse body ─────────────────────────────────────────────────────────────
    let body: { store_id?: unknown; amount?: unknown; remarks?: unknown }

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { store_id, amount, remarks } = body

    // ── Basic input validation (before hitting the RPC) ────────────────────────
    if (!store_id || typeof store_id !== 'string') {
        return NextResponse.json(
            { error: 'Invalid liquidity injection: store_id is required' },
            { status: 400 }
        )
    }

    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(String(amount ?? ''))

    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
        return NextResponse.json(
            { error: 'Invalid liquidity injection amount: must be a positive number' },
            { status: 400 }
        )
    }

    // ── Execute atomic RPC ─────────────────────────────────────────────────────
    const { error: rpcError } = await supabase.rpc('create_cluster_topup', {
        p_store_id: store_id,
        p_amount: parsedAmount,
        p_remarks: typeof remarks === 'string' ? remarks.trim() : null,
    })

    if (rpcError) {
        const msg = rpcError.message ?? ''

        // Map structured RAISE EXCEPTION prefixes → HTTP status codes
        if (msg.includes('UNAUTHORIZED')) return NextResponse.json({ error: 'Unauthorized treasury operation' }, { status: 401 })
        if (msg.includes('FORBIDDEN')) return NextResponse.json({ error: 'Store is outside your cluster scope' }, { status: 403 })
        if (msg.includes('STORE_NOT_FOUND')) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
        if (msg.includes('INVALID_AMOUNT')) return NextResponse.json({ error: 'Invalid liquidity injection amount' }, { status: 400 })

        console.error('[POST /api/treasury/cluster-topup] RPC error:', rpcError)
        return NextResponse.json({ error: 'Treasury execution failed. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}