"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
    getClusterAvailableBalances,
    type StoreAvailableBalance,
} from "@/lib/finance/getClusterAvailableBalances";
import {
    getCashHealth,
    CASH_HEALTH_CONFIG,
    type CashHealth,
} from "@/lib/finance/getCashHealth";
import { getRefillRecommendation } from "@/lib/finance/getRefillRecommendation";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
    Wallet,
    Lock,
    AlertTriangle,
    ArrowUpCircle,
    Banknote,
    RefreshCw,
    X,
    CheckCircle2,
    Clock,
    TrendingDown,
    ShieldAlert,
    Receipt,
    Activity,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreRow {
    id: string;
    name: string;
    monthly_limit: number;
}

interface StorePosition {
    id: string;
    name: string;
    monthlyLimit: number;
    actualBalance: number;
    reservedAmount: number;
    availableBalance: number;
    refill: number;
    utilization: number;
    health: CashHealth;
}

interface ActivityItem {
    id: string;
    kind: "topup" | "debit" | "reservation";
    storeName: string;
    amount: number;
    label: string;
    createdAt: string;
}

interface TopUpState {
    storeId: string;
    storeName: string;
    amount: string;
    remarks: string;
    submitting: boolean;
    error: string | null;
    recommendedAmount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToLabel(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function relativeTime(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60_000);
    const hours = Math.floor(diffMs / 3_600_000);
    const days = Math.floor(diffMs / 86_400_000);
    if (mins < 2) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return isoToLabel(dateStr);
}

/**
 * Reservation utilization: fraction of actual balance locked in active reservations.
 * Operationally signals how much of the physical cash is already committed.
 * Capped at 1 (100%).
 */
function calcUtilization(reservedAmount: number, actualBalance: number): number {
    if (actualBalance <= 0) return reservedAmount > 0 ? 1 : 0;
    return Math.min(reservedAmount / actualBalance, 1);
}

// ─── UI Components ────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="px-6 py-8 max-w-7xl mx-auto">{children}</div>;
}

function SectionHeading({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-3 mb-4 mt-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                {title}
            </h2>
            <div className="flex-1 h-px bg-slate-100" />
        </div>
    );
}

function StatCard({
    icon,
    bg,
    label,
    value,
    sub,
    subColor = "text-slate-400",
    accentClass,
}: {
    icon: React.ReactNode;
    bg: string;
    label: string;
    value: string;
    sub?: string;
    subColor?: string;
    accentClass?: string;
}) {
    return (
        <Card className="rounded-xl border border-slate-200 shadow-sm h-full overflow-hidden">
            {accentClass && <div className={`h-1 ${accentClass}`} />}
            <CardContent className="flex items-start gap-3 px-5 py-5">
                <div className={`p-2 rounded-lg ${bg} flex-shrink-0 mt-0.5`}>{icon}</div>
                <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500 leading-tight">{label}</p>
                    <p className="text-xl font-bold text-slate-900 mt-1 leading-tight tabular-nums">
                        {value}
                    </p>
                    {sub && (
                        <p className={`text-xs mt-1 font-medium ${subColor}`}>{sub}</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function HealthBadge({ health }: { health: CashHealth }) {
    const cfg = CASH_HEALTH_CONFIG[health];
    const label = health === "negative" ? "Critical" : cfg.label;
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${cfg.bg} ${cfg.color} ${cfg.border}`}
        >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
            {label}
        </span>
    );
}

/** Compact horizontal bar. value is 0–1. */
function UtilizationBar({ value }: { value: number }) {
    const pct = Math.round(Math.min(value, 1) * 100);
    const barColor =
        pct >= 80 ? "bg-red-400" : pct >= 50 ? "bg-amber-400" : "bg-emerald-400";
    return (
        <div className="flex items-center gap-2 min-w-[80px]">
            <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden flex-shrink-0">
                <div
                    className={`h-full rounded-full ${barColor} transition-all duration-300`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs tabular-nums text-slate-500 w-8 text-right">
                {pct}%
            </span>
        </div>
    );
}

/** Incident-style card for at-risk stores. */
function RiskCard({
    pos,
    onTopUp,
}: {
    pos: StorePosition;
    onTopUp: () => void;
}) {
    const accentBorder =
        pos.health === "negative" ? "border-l-red-400" : "border-l-amber-400";

    return (
        <div
            className={`bg-white rounded-xl border border-slate-200 border-l-4 ${accentBorder} shadow-sm p-4`}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1 mr-3">
                    <div className="mb-1.5">
                        <HealthBadge health={pos.health} />
                    </div>
                    <p className="font-semibold text-slate-800 text-sm truncate">{pos.name}</p>
                    {pos.monthlyLimit > 0 && (
                        <p className="text-xs text-slate-400 mt-0.5">
                            Target:{" "}
                            <span className="tabular-nums">
                                {formatCurrency(pos.monthlyLimit)}
                            </span>
                        </p>
                    )}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onTopUp}
                    className="flex-shrink-0 whitespace-nowrap"
                >
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                    Top Up
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
                        Available
                    </p>
                    <p
                        className={`text-sm font-bold tabular-nums ${
                            pos.availableBalance < 0 ? "text-red-600" : "text-slate-800"
                        }`}
                    >
                        {formatCurrency(pos.availableBalance)}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
                        Reserved
                    </p>
                    <p
                        className={`text-sm font-bold tabular-nums ${
                            pos.reservedAmount > 0 ? "text-amber-600" : "text-slate-300"
                        }`}
                    >
                        {pos.reservedAmount > 0 ? formatCurrency(pos.reservedAmount) : "—"}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
                        Refill Needed
                    </p>
                    <p
                        className={`text-sm font-bold tabular-nums ${
                            pos.refill > 0 ? "text-indigo-600" : "text-emerald-600"
                        }`}
                    >
                        {pos.refill > 0 ? formatCurrency(pos.refill) : "Funded"}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
                        Utilization
                    </p>
                    <UtilizationBar value={pos.utilization} />
                </div>
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="h-8 w-56 bg-slate-100 rounded-lg" />
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-28 bg-slate-100 rounded-xl" />
                ))}
            </div>
            <div className="h-px bg-slate-100 rounded" />
            <div className="h-48 bg-slate-100 rounded-xl" />
            <div className="h-px bg-slate-100 rounded" />
            <div className="h-72 bg-slate-100 rounded-xl" />
            <div className="h-56 bg-slate-100 rounded-xl" />
        </div>
    );
}

// ─── Top-Up Modal ─────────────────────────────────────────────────────────────

function TopUpModal({
    state,
    onChange,
    onSubmit,
    onClose,
}: {
    state: TopUpState;
    onChange: (patch: Partial<Pick<TopUpState, "amount" | "remarks">>) => void;
    onSubmit: () => void;
    onClose: () => void;
}) {
    const parsedAmount = parseFloat(state.amount);
    const isValid = isFinite(parsedAmount) && parsedAmount > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-50 rounded-lg">
                            <Banknote className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">Inject Liquidity</p>
                            <p className="text-xs text-slate-400 mt-0.5 max-w-[200px] truncate">
                                {state.storeName}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="px-5 py-5 space-y-4">
                    {/* Error banner */}
                    {state.error && (
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-px" />
                            <p className="text-xs text-red-700 font-medium leading-snug">
                                {state.error}
                            </p>
                        </div>
                    )}

                    {/* Smart recommendation callout */}
                    {state.recommendedAmount > 0 && (
                        <div className="flex items-center justify-between px-3.5 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                            <div className="min-w-0 mr-3">
                                <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">
                                    Recommended Top-Up
                                </p>
                                <p className="text-base font-bold text-indigo-800 tabular-nums mt-0.5">
                                    {formatCurrency(state.recommendedAmount)}
                                </p>
                                <p className="text-xs text-indigo-400 mt-0.5">
                                    Restores store to target float
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() =>
                                    onChange({ amount: String(state.recommendedAmount) })
                                }
                                className="flex-shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-indigo-200 hover:border-indigo-300 rounded-lg px-3 py-2 transition-colors"
                            >
                                Use Amount
                            </button>
                        </div>
                    )}

                    {/* Amount */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                            Amount (₹)
                        </label>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            placeholder="Enter amount"
                            value={state.amount}
                            onChange={(e) => onChange({ amount: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 tabular-nums"
                        />
                        {state.amount && !isValid && (
                            <p className="text-xs text-red-500 mt-1">
                                Enter a valid positive amount
                            </p>
                        )}
                    </div>

                    {/* Remarks */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                            Remarks{" "}
                            <span className="text-slate-400 font-normal normal-case">
                                (optional)
                            </span>
                        </label>
                        <textarea
                            rows={2}
                            placeholder="e.g. Monthly float replenishment"
                            value={state.remarks}
                            onChange={(e) => onChange({ remarks: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3 px-5 py-4 bg-slate-50 border-t border-slate-100">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={onClose}
                        disabled={state.submitting}
                        className="flex-1"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={onSubmit}
                        loading={state.submitting}
                        disabled={!isValid || state.submitting}
                        className="flex-1"
                    >
                        Confirm Top-Up
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Activity Feed Row ────────────────────────────────────────────────────────

function ActivityRow({ item }: { item: ActivityItem }) {
    const kindConfig = {
        topup: {
            icon: <Banknote className="w-4 h-4 text-emerald-600" />,
            bg: "bg-emerald-50 border border-emerald-100",
            amountColor: "text-emerald-700",
            prefix: "+",
            kindLabel: "Top-up",
        },
        debit: {
            icon: <TrendingDown className="w-4 h-4 text-slate-500" />,
            bg: "bg-slate-100 border border-slate-200",
            amountColor: "text-slate-700",
            prefix: "−",
            kindLabel: "Executed",
        },
        reservation: {
            icon: <Lock className="w-4 h-4 text-amber-600" />,
            bg: "bg-amber-50 border border-amber-100",
            amountColor: "text-amber-700",
            prefix: "",
            kindLabel: "Reserved",
        },
    } as const;

    const { icon, bg, amountColor, prefix, kindLabel } = kindConfig[item.kind];

    return (
        <div className="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">
            <div className={`p-2 rounded-lg flex-shrink-0 ${bg}`}>{icon}</div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        {kindLabel}
                    </span>
                    <span className="text-[10px] text-slate-300">·</span>
                    <span className="text-[10px] text-slate-400 truncate">{item.storeName}</span>
                </div>
                <p className="text-sm text-slate-700 font-medium truncate">{item.label}</p>
            </div>
            <div className="text-right flex-shrink-0">
                <p className={`text-sm font-semibold tabular-nums ${amountColor}`}>
                    {prefix}
                    {formatCurrency(item.amount)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{relativeTime(item.createdAt)}</p>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClusterLiquidityPage() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [stores, setStores] = useState<StoreRow[]>([]);
    const [balances, setBalances] = useState<StoreAvailableBalance[]>([]);
    const [activity, setActivity] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshTick, setRefreshTick] = useState(0);
    const [topup, setTopup] = useState<TopUpState | null>(null);

    // ── Data loading ─────────────────────────────────────────────────────────

    useEffect(() => {
        if (!user?.cluster_id) return;

        setLoading(true);
        setError(null);

        supabase
            .from("stores")
            .select("id, name, monthly_limit")
            .eq("cluster_id", user.cluster_id)
            .then(async ({ data: storeRows, error: storeErr }) => {
                if (storeErr) {
                    setError(storeErr.message);
                    setLoading(false);
                    return;
                }

                const rows = (storeRows ?? []) as StoreRow[];
                setStores(rows);

                const storeIds = rows.map((s) => s.id);
                if (storeIds.length === 0) {
                    setBalances([]);
                    setActivity([]);
                    setLoading(false);
                    return;
                }

                const nameMap: Record<string, string> = {};
                rows.forEach((s) => {
                    nameMap[s.id] = s.name;
                });

                const [balanceData, topupsResult, expenseResult] = await Promise.all([
                    getClusterAvailableBalances(storeIds),
                    supabase
                        .from("cash_transactions")
                        .select("id, store_id, amount, remarks, created_at")
                        .in("store_id", storeIds)
                        .eq("type", "credit")
                        .order("created_at", { ascending: false })
                        .limit(12),
                    supabase
                        .from("expenses")
                        .select("id, store_id, amount, status, created_at, categories(name)")
                        .in("store_id", storeIds)
                        .in("status", ["submitted", "approved"])
                        .order("created_at", { ascending: false })
                        .limit(20),
                ]);

                setBalances(balanceData);

                const items: ActivityItem[] = [];

                for (const t of topupsResult.data ?? []) {
                    items.push({
                        id: `topup-${t.id}`,
                        kind: "topup",
                        storeName: nameMap[t.store_id] ?? t.store_id,
                        amount: Number(t.amount),
                        label: (t.remarks as string | null) ?? "Treasury top-up",
                        createdAt: t.created_at as string,
                    });
                }

                for (const e of expenseResult.data ?? []) {
                    const catRaw = e.categories;
                    const catName =
                        catRaw === null
                            ? "Expense"
                            : Array.isArray(catRaw)
                            ? (catRaw[0] as { name?: string } | null)?.name ?? "Expense"
                            : (catRaw as { name?: string }).name ?? "Expense";

                    if (e.status === "submitted") {
                        items.push({
                            id: `res-${e.id}`,
                            kind: "reservation",
                            storeName: nameMap[e.store_id as string] ?? (e.store_id as string),
                            amount: Number(e.amount),
                            label: `Reserved — ${catName}`,
                            createdAt: e.created_at as string,
                        });
                    } else {
                        items.push({
                            id: `debit-${e.id}`,
                            kind: "debit",
                            storeName: nameMap[e.store_id as string] ?? (e.store_id as string),
                            amount: Number(e.amount),
                            label: `Executed — ${catName}`,
                            createdAt: e.created_at as string,
                        });
                    }
                }

                items.sort(
                    (a, b) =>
                        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                setActivity(items.slice(0, 15));
                setLoading(false);
            });
    }, [user?.cluster_id, refreshTick]);

    // ── Derived positions ────────────────────────────────────────────────────

    const positions = useMemo<StorePosition[]>(() => {
        const balMap: Record<string, StoreAvailableBalance> = {};
        balances.forEach((b) => {
            balMap[b.storeId] = b;
        });

        return stores.map((s) => {
            const b = balMap[s.id];
            const actual = b?.actualBalance ?? 0;
            const reserved = b?.reservedAmount ?? 0;
            const available = b?.availableBalance ?? 0;
            const refill = getRefillRecommendation(available, s.monthly_limit);
            const health = getCashHealth(available, s.monthly_limit);
            const utilization = calcUtilization(reserved, actual);
            return {
                id: s.id,
                name: s.name,
                monthlyLimit: s.monthly_limit,
                actualBalance: actual,
                reservedAmount: reserved,
                availableBalance: available,
                refill,
                health,
                utilization,
            };
        });
    }, [stores, balances]);

    const kpis = useMemo(() => {
        let totalAvailable = 0;
        let totalReserved = 0;
        let storesAtRisk = 0;
        let totalRefill = 0;

        for (const p of positions) {
            totalAvailable += p.availableBalance;
            totalReserved += p.reservedAmount;
            if (p.health !== "healthy") storesAtRisk++;
            totalRefill += p.refill;
        }

        return { totalAvailable, totalReserved, storesAtRisk, totalRefill };
    }, [positions]);

    const atRiskPositions = useMemo(
        () => positions.filter((p) => p.health !== "healthy"),
        [positions]
    );

    // ── Top-up handlers ──────────────────────────────────────────────────────

    const openTopup = useCallback((pos: StorePosition) => {
        setTopup({
            storeId: pos.id,
            storeName: pos.name,
            amount: "",
            remarks: "",
            submitting: false,
            error: null,
            recommendedAmount: pos.refill,
        });
    }, []);

    const closeTopup = useCallback(() => setTopup(null), []);

    const patchTopup = useCallback(
        (patch: Partial<Pick<TopUpState, "amount" | "remarks">>) => {
            setTopup((prev) => (prev ? { ...prev, ...patch, error: null } : prev));
        },
        []
    );

    const submitTopup = useCallback(async () => {
        if (!topup) return;

        const parsedAmount = parseFloat(topup.amount);
        if (!isFinite(parsedAmount) || parsedAmount <= 0) {
            setTopup((prev) =>
                prev ? { ...prev, error: "Enter a valid positive amount." } : prev
            );
            return;
        }

        setTopup((prev) =>
            prev ? { ...prev, submitting: true, error: null } : prev
        );

        try {
            const res = await fetch("/api/treasury/cluster-topup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    store_id: topup.storeId,
                    amount: parsedAmount,
                    remarks: topup.remarks.trim() || null,
                }),
            });

            const json = (await res.json()) as { success?: boolean; error?: string };

            if (!res.ok || !json.success) {
                setTopup((prev) =>
                    prev
                        ? {
                              ...prev,
                              submitting: false,
                              error: json.error ?? "Top-up failed. Please try again.",
                          }
                        : prev
                );
                return;
            }

            setTopup(null);
            setRefreshTick((n) => n + 1);
        } catch {
            setTopup((prev) =>
                prev
                    ? { ...prev, submitting: false, error: "Network error. Please try again." }
                    : prev
            );
        }
    }, [topup]);

    // ── Guards ───────────────────────────────────────────────────────────────

    if (authLoading) {
        return (
            <PageShell>
                <LoadingState />
            </PageShell>
        );
    }

    if (!user || user.role !== "cluster_manager") {
        return (
            <PageShell>
                <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                    Access restricted to Cluster Managers.
                </div>
            </PageShell>
        );
    }

    if (error) {
        return (
            <PageShell>
                <div className="flex items-start gap-3 px-4 py-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
                    {error}
                </div>
            </PageShell>
        );
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <PageShell>
            {/* Modal */}
            {topup && (
                <TopUpModal
                    state={topup}
                    onChange={patchTopup}
                    onSubmit={submitTopup}
                    onClose={closeTopup}
                />
            )}

            {/* Header */}
            <div className="flex items-start justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                        Treasury Operations
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Cluster liquidity console ·{" "}
                        <span className="font-medium text-slate-600">
                            {stores.length} stores
                        </span>
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRefreshTick((n) => n + 1)}
                    disabled={loading}
                    className="flex items-center gap-1.5 flex-shrink-0"
                >
                    <RefreshCw
                        className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                    />
                    Refresh
                </Button>
            </div>

            {loading ? (
                <LoadingState />
            ) : (
                <>
                    {/* ════════════════════════════════════════════════════════
                        SECTION 1 — Treasury Overview KPIs
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading title="Treasury Overview" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
                        <StatCard
                            icon={<Wallet className="w-4 h-4 text-emerald-600" />}
                            bg="bg-emerald-50"
                            label="Total Available Liquidity"
                            value={formatCurrency(kpis.totalAvailable)}
                            sub={
                                kpis.totalAvailable < 0
                                    ? "Cluster is overdrawn"
                                    : "Net liquid across all stores"
                            }
                            subColor={
                                kpis.totalAvailable < 0 ? "text-red-600" : "text-slate-400"
                            }
                            accentClass={
                                kpis.totalAvailable < 0 ? "bg-red-400" : "bg-emerald-400"
                            }
                        />
                        <StatCard
                            icon={<Lock className="w-4 h-4 text-amber-600" />}
                            bg="bg-amber-50"
                            label="Total Reserved Exposure"
                            value={formatCurrency(kpis.totalReserved)}
                            sub={
                                kpis.totalReserved > 0
                                    ? "Active reservations pending approval"
                                    : "No active reservations"
                            }
                            subColor={
                                kpis.totalReserved > 0 ? "text-amber-600" : "text-emerald-600"
                            }
                            accentClass={
                                kpis.totalReserved > 0 ? "bg-amber-400" : "bg-slate-200"
                            }
                        />
                        <StatCard
                            icon={<ShieldAlert className="w-4 h-4 text-red-500" />}
                            bg="bg-red-50"
                            label="Stores At Risk"
                            value={String(kpis.storesAtRisk)}
                            sub={
                                kpis.storesAtRisk === 0
                                    ? "All stores healthy"
                                    : `${kpis.storesAtRisk} store${kpis.storesAtRisk > 1 ? "s" : ""} need attention`
                            }
                            subColor={
                                kpis.storesAtRisk === 0 ? "text-emerald-600" : "text-red-600"
                            }
                            accentClass={
                                kpis.storesAtRisk === 0 ? "bg-emerald-400" : "bg-red-400"
                            }
                        />
                        <StatCard
                            icon={<ArrowUpCircle className="w-4 h-4 text-indigo-600" />}
                            bg="bg-indigo-50"
                            label="Total Refill Required"
                            value={
                                kpis.totalRefill > 0
                                    ? formatCurrency(kpis.totalRefill)
                                    : "—"
                            }
                            sub={
                                kpis.totalRefill > 0
                                    ? "To restore all stores to target float"
                                    : "All stores at or above target float"
                            }
                            subColor={
                                kpis.totalRefill > 0 ? "text-indigo-600" : "text-emerald-600"
                            }
                            accentClass={
                                kpis.totalRefill > 0 ? "bg-indigo-400" : "bg-emerald-400"
                            }
                        />
                    </div>

                    {/* ════════════════════════════════════════════════════════
                        SECTION 2 — At-Risk Monitoring (conditional)
                    ════════════════════════════════════════════════════════ */}
                    {atRiskPositions.length > 0 && (
                        <>
                            <SectionHeading title="At-Risk Operations" />
                            <div className="flex items-center gap-2 mb-3 px-0.5">
                                <Activity className="w-3.5 h-3.5 text-red-400" />
                                <p className="text-xs text-slate-500 font-medium">
                                    {atRiskPositions.length} store
                                    {atRiskPositions.length !== 1 ? "s" : ""} require
                                    immediate treasury attention
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
                                {atRiskPositions.map((pos) => (
                                    <RiskCard
                                        key={pos.id}
                                        pos={pos}
                                        onTopUp={() => openTopup(pos)}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {/* ════════════════════════════════════════════════════════
                        SECTION 3 — Store Treasury Positions Table
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading title="Store Treasury Positions" />
                    <Card className="rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                        {positions.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-14 text-slate-400">
                                <Receipt className="w-8 h-8 mb-2 text-slate-200" />
                                <p className="text-sm font-medium">
                                    No stores found in this cluster
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {[
                                                "Store",
                                                "Actual Balance",
                                                "Reserved",
                                                "Available",
                                                "Health",
                                                "Utilization",
                                                "Refill Needed",
                                                "",
                                            ].map((h) => (
                                                <th
                                                    key={h}
                                                    className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                                                >
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {positions.map((pos, i) => (
                                            <tr
                                                key={pos.id}
                                                className={`border-b border-slate-50 last:border-0 transition-colors ${
                                                    i % 2 === 0 ? "bg-white" : "bg-slate-50/30"
                                                } ${
                                                    pos.health !== "healthy"
                                                        ? "hover:bg-red-50/20"
                                                        : "hover:bg-slate-50/60"
                                                }`}
                                            >
                                                {/* Store */}
                                                <td className="px-5 py-3.5">
                                                    <div className="flex items-center gap-2">
                                                        {pos.health !== "healthy" && (
                                                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                                        )}
                                                        <span className="font-semibold text-slate-800">
                                                            {pos.name}
                                                        </span>
                                                    </div>
                                                    {pos.monthlyLimit > 0 && (
                                                        <p className="text-xs text-slate-400 mt-0.5 pl-0">
                                                            Target:{" "}
                                                            <span className="tabular-nums">
                                                                {formatCurrency(pos.monthlyLimit)}
                                                            </span>
                                                        </p>
                                                    )}
                                                </td>

                                                {/* Actual Balance */}
                                                <td className="px-5 py-3.5 tabular-nums text-slate-700 font-medium">
                                                    {formatCurrency(pos.actualBalance)}
                                                </td>

                                                {/* Reserved */}
                                                <td className="px-5 py-3.5">
                                                    {pos.reservedAmount > 0 ? (
                                                        <span className="tabular-nums text-amber-700 font-medium">
                                                            {formatCurrency(pos.reservedAmount)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300">—</span>
                                                    )}
                                                </td>

                                                {/* Available — primary operational metric */}
                                                <td className="px-5 py-3.5">
                                                    <span
                                                        className={`tabular-nums font-bold ${
                                                            pos.availableBalance < 0
                                                                ? "text-red-600"
                                                                : pos.health === "low"
                                                                ? "text-amber-700"
                                                                : "text-slate-900"
                                                        }`}
                                                    >
                                                        {formatCurrency(pos.availableBalance)}
                                                    </span>
                                                </td>

                                                {/* Health */}
                                                <td className="px-5 py-3.5">
                                                    <HealthBadge health={pos.health} />
                                                </td>

                                                {/* Utilization */}
                                                <td className="px-5 py-3.5">
                                                    <UtilizationBar value={pos.utilization} />
                                                </td>

                                                {/* Refill */}
                                                <td className="px-5 py-3.5">
                                                    {pos.refill > 0 ? (
                                                        <span className="tabular-nums text-indigo-600 font-semibold">
                                                            {formatCurrency(pos.refill)}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            Funded
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Action */}
                                                <td className="px-5 py-3.5">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => openTopup(pos)}
                                                        className="whitespace-nowrap"
                                                    >
                                                        <ArrowUpCircle className="w-3.5 h-3.5" />
                                                        Top Up
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>

                    {/* ════════════════════════════════════════════════════════
                        SECTION 4 — Recent Treasury Activity
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading title="Recent Treasury Activity" />
                    <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        {/* Legend */}
                        <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                Top-up
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className="w-2 h-2 rounded-full bg-amber-400" />
                                Reservation
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className="w-2 h-2 rounded-full bg-slate-400" />
                                Executed debit
                            </span>
                        </div>

                        {activity.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                <Clock className="w-8 h-8 mb-2 text-slate-200" />
                                <p className="text-sm font-medium">
                                    No recent treasury activity
                                </p>
                            </div>
                        ) : (
                            <div className="px-5 divide-y divide-slate-50">
                                {activity.map((item) => (
                                    <ActivityRow key={item.id} item={item} />
                                ))}
                            </div>
                        )}
                    </Card>
                </>
            )}
        </PageShell>
    );
}
