import { SupabaseClient } from "@supabase/supabase-js";
import { getClusterBalances } from "@/lib/finance/getClusterBalances";

export async function fetchRawData(supabase: SupabaseClient) {
  // 1. Fetch stores
  const { data: storeData, error: storeErr } = await supabase
    .from("stores")
    .select("id, name, monthly_limit, cluster_id, clusters(id, name)");

  if (storeErr) throw storeErr;

  const rawStores = storeData ?? [];
  const storeIds = rawStores.map((s: any) => s.id);

  if (storeIds.length === 0) {
    return { rawStores: [], rawBalances: [], rawExpenses: [] };
  }

  // 2. Fetch balances (Batched query, NO N+1) and expenses
  const [balances, expResult] = await Promise.all([
    getClusterBalances(storeIds),
    supabase
      .from("expenses")
      .select(
        "id, amount, status, expense_month, created_at, store_id, categories(name)"
      )
      .order("created_at", { ascending: false }),
  ]);

  if (expResult.error) throw expResult.error;

  return {
    rawStores,
    rawBalances: balances,
    rawExpenses: expResult.data ?? [],
  };
}
