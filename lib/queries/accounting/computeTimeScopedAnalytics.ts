import { AnalyticsContext, TimeScopedAnalytics } from "@/types/analytics";
import { DateRangeFilter } from "@/lib/hooks/useDashboardFilters";
import { PENDING_STATUSES } from "@/lib/constants/expenseStatuses";

const APPROVED_STATUSES = ["accounting_approved", "synced_to_tally"];

function isDateInRange(dateStr: string, range?: DateRangeFilter) {
  if (!range || range === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (range === "this_month") {
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  }
  if (range === "last_month") {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return (
      d.getMonth() === lastMonth.getMonth() &&
      d.getFullYear() === lastMonth.getFullYear()
    );
  }
  if (range === "last_3_months") {
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    return d >= threeMonthsAgo;
  }
  if (range === "last_6_months") {
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    return d >= sixMonthsAgo;
  }
  return true;
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

export function computeTimeScopedAnalytics(
  context: AnalyticsContext
): TimeScopedAnalytics {
  const { stores, expenses, filters } = context;

  // 1. Filter active stores based on `filters.selectedStores` and `filters.treasuryHealth`
  const activeStoreIds = stores
    .filter((s) => {
      if (
        filters.selectedStores &&
        filters.selectedStores.length > 0 &&
        !filters.selectedStores.includes(s.id)
      ) {
        return false;
      }
      if (
        filters.treasuryHealth &&
        filters.treasuryHealth.length > 0 &&
        !filters.treasuryHealth.includes(s.derivedState.health)
      ) {
        return false;
      }
      return true;
    })
    .map((s) => s.id);

  // 2. Filter expenses
  const filteredExpenses = expenses.filter((e) => {
    if (!activeStoreIds.includes(e.storeId)) return false;
    return isDateInRange(e.createdAt, filters.dateRange);
  });

  const filteredApproved = filteredExpenses.filter((e) =>
    APPROVED_STATUSES.includes(e.status)
  );
  const filteredPending = filteredExpenses.filter((e) =>
    (PENDING_STATUSES as readonly string[]).includes(e.status)
  );

  const filteredApprovedSpend = filteredApproved.reduce(
    (s, e) => s + e.amount,
    0
  );
  const filteredPendingPipeline = filteredPending.reduce(
    (s, e) => s + e.amount,
    0
  );
  const filteredExpenseCount = filteredExpenses.length;

  // Burn Trend
  const burnMap: Record<string, number> = {};
  filteredApproved.forEach((e) => {
    const key = e.expenseMonth ? e.expenseMonth.slice(0, 7) : monthKey(e.createdAt);
    burnMap[key] = (burnMap[key] ?? 0) + e.amount;
  });

  const burnTrendData: { month: string; amount: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    burnTrendData.push({
      month: monthLabel(key),
      amount: burnMap[key] ?? 0,
    });
  }

  // Cluster Spend
  const clusterSpendMap: Record<string, number> = {};
  filteredApproved.forEach((e) => {
    const store = stores.find((s) => s.id === e.storeId);
    const cName = store?.clusterName ?? "Unknown";
    clusterSpendMap[cName] = (clusterSpendMap[cName] ?? 0) + e.amount;
  });
  const clusterSpendData = Object.entries(clusterSpendMap)
    .map(([name, value]) => ({
      name: name.length > 15 ? name.slice(0, 15) + "…" : name,
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Category Spend
  const categorySpendMap: Record<string, number> = {};
  filteredApproved.forEach((e) => {
    const k = e.categoryName;
    categorySpendMap[k] = (categorySpendMap[k] ?? 0) + e.amount;
  });
  const categorySpendData = Object.entries(categorySpendMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    filteredApprovedSpend,
    filteredPendingPipeline,
    filteredExpenseCount,
    burnTrendData,
    clusterSpendData,
    categorySpendData,
  };
}
