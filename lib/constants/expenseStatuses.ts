/**
 * Expenses still in the active treasury pipeline.
 *
 * draft     = not yet submitted to cluster
 * submitted = active reservation; awaiting cluster final approval
 *
 * NOTE: `cluster_approved` is intentionally excluded.
 * In the treasury-centric model, cluster approval is the FINAL
 * execution step — it normalizes to 'approved', not 'pending'.
 */
export const PENDING_STATUSES = [
    "draft",
    "submitted",
] as const;

/**
 * All raw DB states representing a finalized, approved treasury operation.
 *
 * Prefer normalizeExpenseStatus(status) === 'approved' for
 * operational business logic. Use this constant only for
 * DB wide-net queries that must catch legacy records.
 */
export const FINAL_APPROVED_STATUSES = [
    "approved",
    "cluster_approved",
    "accounting_approved",
    "synced_to_tally",
] as const;

/**
 * All raw DB states representing a rejected or released expense.
 *
 * Prefer normalizeExpenseStatus(status) === 'rejected' for
 * operational business logic.
 */
export const REJECTED_STATUSES = [
    "rejected",
    "cluster_rejected",
    "accounting_rejected",
    "tally_sync_failed",
] as const;

/**
 * Expenses actively awaiting cluster treasury action.
 *
 * Cluster managers are the FINAL treasury operators.
 * Only 'submitted' expenses need cluster attention.
 *
 * NOTE: `cluster_approved` is excluded — cluster approval finalizes
 * the expense. It no longer remains in the active approval queue.
 */
export const ACTIVE_APPROVAL_STATUSES = [
    "submitted",
] as const;

/**
 * Legacy approval flow DB states — preserved for backward compatibility
 * and historical analytics. These are artifacts from the multi-stage
 * approval workflow that pre-dates treasury-centric normalization.
 *
 * DO NOT use for new operational logic. Use normalizeExpenseStatus() instead.
 */
export const LEGACY_APPROVAL_STATUSES = [
    "cluster_approved",
    "accounting_approved",
    "cluster_rejected",
    "accounting_rejected",
] as const;