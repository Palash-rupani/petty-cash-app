import { EnterpriseKPIs, ClusterTreasuryPosition } from "./treasury";
import { TimeScopedAnalytics, StrategicInsight } from "./analytics";

export interface DashboardMetadata {
  generatedAt: string;

  activeStoreCount: number;

  filteredStoreCount: number;

  storeFilterList: { id: string; name: string }[];
}

export interface AccountingDashboardPayload {
  enterprise: {
    kpis: EnterpriseKPIs;

    clusterMatrix: ClusterTreasuryPosition[];

    insights: StrategicInsight[];
  };

  analytics: {
    timeScoped: TimeScopedAnalytics;
  };

  metadata: DashboardMetadata;
}
