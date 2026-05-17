import { createClient } from '@/lib/supabase/client'

export interface StoreBalance {
    storeId: string
    balance: number
}

/**
 * Fetches the current ledger balance for each store in `storeIds`.
 *
 * A single query fetches all cash_transactions for the store set and
 * aggregates client-side — one round-trip regardless of cluster size.
 *
 * Formula: SUM(credits + adjustments) - SUM(debits)
 *
 * Returns [] on any Supabase error so callers receive a safe fallback.
 * Stores with no transactions are included with balance = 0.
 */
export async function getClusterBalances(storeIds: string[]): Promise<StoreBalance[]> {
    if (storeIds.length === 0) return []

    const supabase = createClient()
    const { data, error } = await supabase
        .from('cash_transactions')
        .select('store_id, type, amount')
        .in('store_id', storeIds)

    if (error) {
        console.error('Failed to load cluster balances:', error)
        return []
    }

    const map: Record<string, number> = {}
    for (const t of data ?? []) {
        const delta =
            t.type === 'credit' || t.type === 'adjustment'
                ? Number(t.amount)
                : -Number(t.amount)
        map[t.store_id] = (map[t.store_id] ?? 0) + delta
    }

    // Every requested store gets an entry — 0 for stores with no transactions.
    return storeIds.map((id) => ({ storeId: id, balance: map[id] ?? 0 }))
}
