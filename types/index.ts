export type Role = 'store_manager' | 'cluster_manager' | 'accounting';

export type ExpenseStatus =
  | 'draft'
  | 'submitted'

  // Legacy approval flow
  | 'cluster_approved'
  | 'cluster_rejected'
  | 'accounting_approved'
  | 'accounting_rejected'

  // New cluster-centric flow
  | 'approved'
  | 'rejected'

  // External sync states
  | 'synced_to_tally'
  | 'tally_sync_failed';

export type ReservationStatus =
  | 'active'
  | 'finalized'
  | 'released';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  store_id?: string;
  cluster_id?: string;
  phone?: string;
  notification_preference?: string;
  created_at: string;
}

export interface Store {
  id: string;
  name: string;
  cluster_id: string;
  monthly_limit: number;
  created_at: string;
}

export interface Cluster {
  id: string;
  name: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  store_id: string;
  created_by: string;
  updated_by?: string;
  category_id: string;
  amount: number;
  description?: string;
  receipt_url?: string;
  expense_month: string;
  status: ExpenseStatus;

  // Legacy approval fields
  cluster_approved_by?: string;
  accounting_approved_by?: string;

  rejection_reason?: string;

  tally_sync_status?: string;
  tally_voucher_id?: string;

  created_at: string;
  updated_at: string;

  // Joined fields
  store?: Store;
  category?: Category;
  creator?: User;
}

export interface TreasuryReservation {
  id: string;

  expense_id: string;

  store_id: string;

  amount: number;

  status: ReservationStatus;

  created_by?: string;

  created_at: string;

  finalized_at?: string;

  released_at?: string;

  released_reason?: string;
}

export interface AuditLog {
  id: string;
  expense_id: string;
  action: string;
  performed_by: string;
  remarks?: string;
  created_at: string;
  performer?: User;
}