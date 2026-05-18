import { SupabaseClient } from "@supabase/supabase-js";
import { DashboardFilters, AnalyticsContext } from "@/types/analytics";
import { AccountingDashboardPayload, DashboardMetadata } from "@/types/dashboard";

import { fetchRawData } from "./fetchRawData";
import { normalizeData } from "./normalizeData";
import { computeClusterMatrix } from "./computeClusterMatrix";
import { computeEnterpriseKPIs } from "./computeEnterpriseKPIs";
import { computeTimeScopedAnalytics } from "./computeTimeScopedAnalytics";
import { generateStrategicInsights } from "./generateStrategicInsights";

export async function getAccountingDashboardData(
  supabase: SupabaseClient,
  filters: DashboardFilters
): Promise<AccountingDashboardPayload> {
  // 1. FETCH RAW DATA
  const raw = await fetchRawData(supabase);

  // 2. NORMALIZE + PRECOMPUTE TREASURY STATE
  const { stores, expenses } = normalizeData(
    raw.rawStores,
    raw.rawExpenses,
    raw.rawBalances
  );

  // 3. ENTERPRISE / GLOBAL STATE (MUST IGNORE FILTERS)
  const clusterMatrix = computeClusterMatrix(stores, expenses);
  const kpis = computeEnterpriseKPIs(clusterMatrix);

  // 4. ANALYTICS CONTEXT
  const context: AnalyticsContext = {
    stores,
    expenses,
    clusterMatrix,
    globalKPIs: kpis,
    filters,
  };

  // 5. FILTERED ANALYTICS
  const timeScoped = computeTimeScopedAnalytics(context);

  // 6. INSIGHTS
  const insights = generateStrategicInsights(context);

  // 7. METADATA
  const metadata: DashboardMetadata = {
    generatedAt: new Date().toISOString(),
    activeStoreCount: stores.length,
    filteredStoreCount: filters.selectedStores?.length || stores.length,
    storeFilterList: (filters.selectedStores?.length
      ? stores.filter((s) => filters.selectedStores!.includes(s.id))
      : stores
    ).map((s) => ({ id: s.id, name: s.name })),
  };

  // 8. FINAL PAYLOAD
  return {
    enterprise: {
      kpis,
      clusterMatrix,
      insights,
    },
    analytics: {
      timeScoped,
    },
    metadata,
  };
}
