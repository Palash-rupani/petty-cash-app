import { ExpenseStatus } from "./index";
import { TreasuryHealth } from "@/lib/hooks/useDashboardFilters";

export interface NormalizedStore {
  id: string;
  name: string;

  clusterId: string;
  clusterName: string;

  targetFloat: number;
  ledgerBalance: number;

  derivedState: {
    health: TreasuryHealth;
    refillNeeded: number;
    liquiditySeverity?: string;
  };
}

export interface NormalizedExpense {
  id: string;
  storeId: string;
  amount: number;
  status: ExpenseStatus;

  categoryName: string;

  createdAt: string;
  expenseMonth: string;
}
