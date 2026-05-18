import { NormalizedStore, NormalizedExpense } from "./normalized";
import { ClusterTreasuryPosition, EnterpriseKPIs } from "./treasury";
import { TreasuryHealth, DateRangeFilter } from "@/lib/hooks/useDashboardFilters";

export interface BurnTrendPoint {
  month: string;
  amount: number;
}

export interface SpendDistributionPoint {
  name: string;
  value: number;
}

export interface StrategicInsight {
  text: string;

  severity:
    | "info"
    | "warning"
    | "danger"
    | "success";

  iconType:
    | "alert"
    | "shield"
    | "activity"
    | "zap"
    | "landmark"
    | "target";
}

export interface TimeScopedAnalytics {
  filteredApprovedSpend: number;

  filteredPendingPipeline: number;

  filteredExpenseCount: number;

  burnTrendData: BurnTrendPoint[];

  clusterSpendData: SpendDistributionPoint[];

  categorySpendData: SpendDistributionPoint[];
}

export interface DashboardFilters {
  dateRange?: DateRangeFilter;

  selectedStores?: string[];

  treasuryHealth?: TreasuryHealth[];
}

export interface AnalyticsContext {
  stores: NormalizedStore[];

  expenses: NormalizedExpense[];

  clusterMatrix: ClusterTreasuryPosition[];

  globalKPIs: EnterpriseKPIs;

  filters: DashboardFilters;
}
