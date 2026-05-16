import { createClient } from '@/lib/supabase/client'

/**
 * Fetches the current ledger balance for a store from cash_transactions.
 *
 * Formula: SUM(credits + adjustments) - SUM(debits)
 *
 * Returns:
 *   number  — the calculated balance (may be 0 or negative, both valid)
 *   null    — balance could not be determined (network error, RLS failure, etc.)
 *
 * Callers MUST treat null as "unavailable" and must NOT fall back to 0,
 * as 0 is a legitimate balance value.
 */
export async function getStoreBalance(storeId: string): Promise<number | null> {
    const supabase = createClient()

    const { data, error } = await supabase
        .from('cash_transactions')
        .select('type, amount')
        .eq('store_id', storeId)

    if (error) return null
    if (!data) return null

    // Empty ledger is a valid state — no transactions means zero balance
    return data.reduce((total, txn) => {
        if (txn.type === 'credit' || txn.type === 'adjustment') {
            return total + Number(txn.amount)
        }
        if (txn.type === 'debit') {
            return total - Number(txn.amount)
        }
        return total
    }, 0)
}