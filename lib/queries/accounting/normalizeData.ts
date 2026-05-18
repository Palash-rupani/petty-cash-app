import { NormalizedStore, NormalizedExpense } from "@/types/normalized";
import { getCashHealth } from "@/lib/finance/getCashHealth";
import { getRefillRecommendation } from "@/lib/finance/getRefillRecommendation";
import { getClusterName } from "@/lib/utils/getClusterName";
import { ExpenseStatus } from "@/types";

export function normalizeData(
  rawStores: any[],
  rawExpenses: any[],
  rawBalances: { storeId: string; balance: number }[]
) {
  // PERFORMANCE BOUNDARY:
  // We compute cash health and refill metrics EXACTLY ONCE here.
  // DO NOT recalculate these in later analytics loops.

  const balanceMap: Record<string, number> = {};
  rawBalances.forEach((b) => {
    balanceMap[b.storeId] = b.balance;
  });

  const stores: NormalizedStore[] = rawStores.map((s) => {
    const balance = balanceMap[s.id] ?? 0;
    const limit = s.monthly_limit ?? 0;

    return {
      id: s.id,
      name: s.name,
      clusterId: s.cluster_id,
      clusterName: getClusterName(s.clusters),
      targetFloat: limit,
      ledgerBalance: balance,
      derivedState: {
        health: getCashHealth(balance, limit),
        refillNeeded: getRefillRecommendation(balance, limit),
      },
    };
  });

  const expenses: NormalizedExpense[] = rawExpenses.map((e) => {
    const category = e.categories
      ? Array.isArray(e.categories)
        ? e.categories[0]
        : e.categories
      : null;

    return {
      id: e.id,
      storeId: e.store_id,
      amount: e.amount,
      status: e.status as ExpenseStatus,
      categoryName: category?.name ?? "Uncategorized",
      createdAt: e.created_at,
      expenseMonth: e.expense_month,
    };
  });

  return { stores, expenses };
}
