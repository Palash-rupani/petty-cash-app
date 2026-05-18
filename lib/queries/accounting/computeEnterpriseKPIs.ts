import { ClusterTreasuryPosition, EnterpriseKPIs } from "@/types/treasury";

export function computeEnterpriseKPIs(
  matrix: ClusterTreasuryPosition[]
): EnterpriseKPIs {
  // IMPORTANT: THIS MODULE MUST IGNORE FILTERS.
  
  const totalTreasuryBalance = matrix.reduce((s, p) => s + p.balance, 0);
  const totalRefillRequirement = matrix.reduce((s, p) => s + p.refillNeed, 0);
  const totalCriticalStores = matrix.reduce((s, p) => s + p.criticalStores, 0);
  const enterprisePipelineExposure = matrix.reduce(
    (s, p) => s + p.pipelineExposure,
    0
  );

  const largestExposureCluster =
    matrix.length > 0
      ? [...matrix]
          .sort((a, b) => b.pipelineExposure - a.pipelineExposure)[0]
      : null;

  return {
    totalTreasuryBalance,
    totalRefillRequirement,
    totalCriticalStores,
    enterprisePipelineExposure,
    largestExposureCluster: largestExposureCluster
      ? {
          name: largestExposureCluster.name,
          exposure: largestExposureCluster.pipelineExposure,
        }
      : null,
  };
}
