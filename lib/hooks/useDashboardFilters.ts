import { useState } from "react";

export type DateRangeFilter = "this_month" | "last_month" | "last_3_months" | "last_6_months" | "all";
export type TreasuryHealth = "healthy" | "low" | "negative";

export interface DashboardFilters {
    dateRange: DateRangeFilter;
    selectedStores: string[];
    treasuryHealth: TreasuryHealth[];
}

export function useDashboardFilters(initialFilters?: Partial<DashboardFilters>) {
    const [filters, setFilters] = useState<DashboardFilters>({
        dateRange: "this_month",
        selectedStores: [],
        treasuryHealth: [],
        ...initialFilters,
    });

    const setFilter = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
    };

    return {
        filters,
        setFilter,
        setFilters,
    };
}
