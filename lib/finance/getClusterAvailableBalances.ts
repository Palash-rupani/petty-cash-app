import { createClient } from "@/lib/supabase/client";

export interface StoreAvailableBalance {
    storeId: string;
    /** Credits + adjustments − debits from cash_transactions */
    actualBalance: number;
    /** Sum of active treasury_reservations for this store */
    reservedAmount: number;
    /** actualBalance − reservedAmount — the operationally liquid amount */
    availableBalance: number;
}

/**
 * Fetches actualBalance, reservedAmount, and availableBalance for every store
 * in `storeIds` in two parallel queries (one round-trip each).
 *
 * Formula:
 *   actualBalance    = SUM(credits + adjustments) − SUM(debits)
 *   reservedAmount   = SUM(active treasury_reservations.amount)
 *   availableBalance = actualBalance − reservedAmount
 *
 * Stores with no transactions / reservations receive 0 for those fields.
 * Returns [] on storeIds being empty.
 */
export async function getClusterAvailableBalances(
    storeIds: string[]
): Promise<StoreAvailableBalance[]> {
    if (storeIds.length === 0) return [];

    const supabase = createClient();

    const [txResult, resResult] = await Promise.all([
        supabase
            .from("cash_transactions")
            .select("store_id, type, amount")
            .in("store_id", storeIds),
        supabase
            .from("treasury_reservations")
            .select("store_id, amount")
            .in("store_id", storeIds)
            .eq("status", "active"),
    ]);

    // Build actual balance map from ledger transactions
    const actualMap: Record<string, number> = {};
    for (const t of txResult.data ?? []) {
        const delta =
            t.type === "credit" || t.type === "adjustment"
                ? Number(t.amount)
                : -Number(t.amount);
        actualMap[t.store_id] = (actualMap[t.store_id] ?? 0) + delta;
    }

    // Build reservation map
    const reservedMap: Record<string, number> = {};
    for (const r of resResult.data ?? []) {
        reservedMap[r.store_id] =
            (reservedMap[r.store_id] ?? 0) + Number(r.amount);
    }

    return storeIds.map((id) => {
        const actualBalance = actualMap[id] ?? 0;
        const reservedAmount = reservedMap[id] ?? 0;
        return {
            storeId: id,
            actualBalance,
            reservedAmount,
            availableBalance: actualBalance - reservedAmount,
        };
    });
}
