import { NormalizedStore, NormalizedExpense } from "@/types/normalized";
import { ClusterTreasuryPosition } from "@/types/treasury";
import { normalizeExpenseStatus } from "@/types";

export function computeClusterMatrix(
  stores: NormalizedStore[],
  expenses: NormalizedExpense[]
): ClusterTreasuryPosition[] {
  // IMPORTANT: THIS MODULE MUST IGNORE FILTERS.
  
  const map: Record<string, ClusterTreasuryPosition> = {};

  // Seed from all stores
  stores.forEach((s) => {
    const cid = s.clusterId;
    if (!cid) return; // Skip stores without clusters

    if (!map[cid]) {
      map[cid] = {
        clusterId: cid,
        name: s.clusterName,
        balance: 0,
        targetFloat: 0,
        refillNeed: 0,
        criticalStores: 0,
        storeCount: 0,
        pipelineExposure: 0,
      };
    }

    const pos = map[cid];
    const { health, refillNeeded } = s.derivedState;

    pos.storeCount++;
    pos.balance += s.ledgerBalance;
    pos.targetFloat += s.targetFloat;
    pos.refillNeed += refillNeeded;
    
    if (health === "low" || health === "negative") pos.criticalStores++;
  });

  // Add pending exposure from all expenses
  expenses.forEach((e) => {
    // submitted = active treasury reservation awaiting cluster final approval
    if (normalizeExpenseStatus(e.status) === "submitted") {
      const store = stores.find((s) => s.id === e.storeId);
      if (store && store.clusterId && map[store.clusterId]) {
        map[store.clusterId].pipelineExposure += e.amount;
      }
    }
  });

  // Return sorted by balance
  return Object.values(map).sort((a, b) => a.balance - b.balance);
}
