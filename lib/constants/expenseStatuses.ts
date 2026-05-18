export const PENDING_STATUSES = [
    "draft",
    "submitted",
    "cluster_approved",
] as const;

export const FINAL_APPROVED_STATUSES = [
    "approved",
    "accounting_approved",
] as const;

export const REJECTED_STATUSES = [
    "rejected",
    "cluster_rejected",
    "accounting_rejected",
] as const;

export const ACTIVE_APPROVAL_STATUSES = [
    "submitted",
    "cluster_approved",
] as const;

export const LEGACY_APPROVAL_STATUSES = [
    "cluster_approved",
    "accounting_approved",
    "cluster_rejected",
    "accounting_rejected",
] as const;