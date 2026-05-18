export interface EnterpriseKPIs {
  totalTreasuryBalance: number;
  totalRefillRequirement: number;
  totalCriticalStores: number;

  enterprisePipelineExposure: number;

  largestExposureCluster:
    | {
        name: string;
        exposure: number;
      }
    | null;
}

export interface ClusterTreasuryPosition {
  clusterId: string;

  name: string;

  balance: number;

  targetFloat: number;

  refillNeed: number;

  criticalStores: number;

  storeCount: number;

  pipelineExposure: number;
}
