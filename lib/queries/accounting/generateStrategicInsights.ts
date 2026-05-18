import { AnalyticsContext, StrategicInsight } from "@/types/analytics";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export function generateStrategicInsights(
  context: AnalyticsContext
): StrategicInsight[] {
  const { globalKPIs, clusterMatrix, stores } = context;
  const insights: StrategicInsight[] = [];

  // Highest refill cluster
  const topRefill = [...clusterMatrix].sort((a, b) => b.refillNeed - a.refillNeed)[0];
  if (
    topRefill &&
    topRefill.refillNeed > 0 &&
    globalKPIs.totalRefillRequirement > 0
  ) {
    const pct = Math.round(
      (topRefill.refillNeed / globalKPIs.totalRefillRequirement) * 100
    );
    if (pct >= 30) {
      insights.push({
        text: `Refill Concentration: ${
          topRefill.name
        } accounts for ${pct}% of the total enterprise refill requirement (${formatCurrency(
          topRefill.refillNeed
        )}).`,
        severity: "warning",
        iconType: "alert",
      });
    }
  }

  // Critical Stores cluster
  const highRisk = clusterMatrix.filter((p) => p.criticalStores >= 2);
  if (highRisk.length > 0) {
    insights.push({
      text: `High Risk Clusters: ${highRisk.length} cluster(s) have multiple stores with critical cash levels. Urgent capital allocation required.`,
      severity: "danger",
      iconType: "shield",
    });
  } else if (globalKPIs.totalCriticalStores === 0) {
    insights.push({
      text: `Enterprise Liquidity: All ${stores.length} stores are operating with healthy cash floats.`,
      severity: "success",
      iconType: "activity",
    });
  }

  // Abnormal Exposure
  if (
    globalKPIs.largestExposureCluster &&
    globalKPIs.largestExposureCluster.exposure > 50000
  ) {
    insights.push({
      text: `Abnormal Exposure: ${
        globalKPIs.largestExposureCluster.name
      } has a significant pending pipeline of ${formatCurrency(
        globalKPIs.largestExposureCluster.exposure
      )}. Expedite approvals to prevent cash flow stall.`,
      severity: "warning",
      iconType: "zap",
    });
  }

  // General pipeline
  if (globalKPIs.totalTreasuryBalance < 0) {
    insights.push({
      text: `Severe Treasury Imbalance: Overall enterprise ledger is in deficit by ${formatCurrency(
        Math.abs(globalKPIs.totalTreasuryBalance)
      )}. Review immediate liabilities.`,
      severity: "danger",
      iconType: "landmark",
    });
  } else if (globalKPIs.totalRefillRequirement === 0) {
    insights.push({
      text: `Optimal Allocation: The enterprise treasury is perfectly balanced with no immediate refill requirements detected.`,
      severity: "info",
      iconType: "target",
    });
  }

  return insights.slice(0, 4);
}
