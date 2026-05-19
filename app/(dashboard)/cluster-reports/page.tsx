"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getClusterAvailableBalances } from "@/lib/finance/getClusterAvailableBalances";
import { getCashHealth } from "@/lib/finance/getCashHealth";
import { getRefillRecommendation } from "@/lib/finance/getRefillRecommendation";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { DashboardFilterBar } from "@/components/dashboard/DashboardFilterBar";
import { useDashboardFilters, DateRangeFilter } from "@/lib/hooks/useDashboardFilters";
import { Badge } from "@/components/ui/Badge";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, Cell,
} from "recharts";
import {
    TrendingUp, Wallet, Receipt, ArrowUpCircle, ExternalLink,
    Clock, XCircle, AlertTriangle, CheckCircle2, Store,
    ChevronRight, ShieldAlert, Activity, RefreshCw,
    Landmark, ArrowDownCircle, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Expense {
    id: string;
    amount: number;
    status: string;
    expense_month: string | null;
    created_at: string;
    receipt_url: string | null;
    store_id: string;
    stores: { name: string; monthly_limit: number } | null;
    categories: { name: string } | null;
}

interface StoreRow {
    id: string;
    name: string;
    monthly_limit: number;
}

interface TreasuryCredit {
    id: string;
    store_id: string;
    amount: number;
    remarks: string | null;
    created_at: string;
    storeName: string;
}

// Per-store enriched treasury position — derived from expenses + ledger balances
interface StoreTreasuryPosition {
    storeId: string;
    name: string;
    targetFloat: number;
    balance: number;          // actualBalance (credits − debits)
    reservedAmount: number;   // sum of active treasury_reservations
    availableBalance: number; // balance − reservedAmount (primary liquidity metric)
    pendingAmount: number;
    pendingCount: number;
    approved: number;
    rejected: number;
    expenseCount: number;
    // oldest submitted expense in ms epoch (for aging)
    oldestSubmittedAt: number | null;
}

import { PENDING_STATUSES } from "@/lib/constants/expenseStatuses";

// ─── Status Groups ────────────────────────────────────────────────────────────

const APPROVED_STATUSES = ["accounting_approved", "synced_to_tally"];
const REJECTED_STATUSES = ["cluster_rejected", "accounting_rejected", "tally_sync_failed"];
const SUBMITTED_STATUSES = ["submitted"];
const ACCT_PENDING = ["cluster_approved"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToLabel(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
    });
}

function daysAgo(isoStr: string) {
    return Math.floor((Date.now() - new Date(isoStr).getTime()) / (1000 * 60 * 60 * 24));
}

function monthKey(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", {
        month: "short", year: "2-digit",
    });
}

function normaliseJoin<T>(raw: T | T[] | null): T | null {
    if (raw === null || raw === undefined) return null;
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw;
}

function sumAmount(arr: Expense[]) {
    return arr.reduce((s, e) => s + e.amount, 0);
}

function isDateInRange(dateStr: string, range: DateRangeFilter) {
    if (range === "all") return true;
    const d = new Date(dateStr);
    const now = new Date();
    if (range === "this_month") {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    if (range === "last_month") {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return d.getMonth() === lastMonth.getMonth() && d.getFullYear() === lastMonth.getFullYear();
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

const currencyFmt = (v: number | string) =>
    formatCurrency(typeof v === "number" ? v : Number(v));

// ─── Health badge ─────────────────────────────────────────────────────────────

function HealthBadge({ balance, targetFloat }: { balance: number; targetFloat: number }) {
    const health = getCashHealth(balance, targetFloat);
    const config = {
        healthy: { label: "Stable", dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
        low: { label: "Monitor Closely", dot: "bg-amber-500", cls: "bg-amber-50 text-amber-700 border-amber-200" },
        negative: { label: "Urgent Refill Needed", dot: "bg-red-500", cls: "bg-red-50 text-red-700 border-red-200" },
    } as const;
    const { label, dot, cls } = config[health];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
            {label}
        </span>
    );
}

// ─── Reusable sub-components ──────────────────────────────────────────────────

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
    icon, bg, label, value, sub, subColor = "text-slate-400",
}: {
    icon: React.ReactNode; bg: string; label: string;
    value: string; sub?: string; subColor?: string;
}) {
    return (
        <Card className="rounded-xl border border-slate-200 shadow-sm h-full">
            <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${bg} flex-shrink-0 mt-0.5`}>{icon}</div>
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-500 leading-tight">{label}</p>
                        <p className="text-xl font-bold text-slate-900 mt-1 leading-tight tabular-nums">{value}</p>
                        {sub && <p className={`text-xs mt-1 font-medium ${subColor}`}>{sub}</p>}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function PipelineStep({ label, count, amount, color, icon }: {
    label: string; count: number; amount: number; color: string; icon: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">
            <div className="p-2 rounded-lg flex-shrink-0" style={{ backgroundColor: color + "18" }}>
                <div style={{ color }}>{icon}</div>
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-medium text-slate-700">{label}</span>
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{count}</span>
                </div>
                <span className="text-xs text-slate-400">{formatCurrency(amount)}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-200 flex-shrink-0" />
        </div>
    );
}

function EmptyChart() {
    return (
        <div className="flex items-center justify-center h-[180px] text-slate-300 text-sm">
            No data for this period
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="h-8 w-56 bg-slate-100 rounded-lg" />
            <div className="h-12 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
                {[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="h-48 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-56 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="h-64 bg-slate-100 rounded-xl" />
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClusterReportsPage() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [stores, setStores] = useState<StoreRow[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [rawTrendData, setRawTrendData] = useState<{ amount: number, expense_month: string | null, created_at: string, status: string, store_id: string }[]>([]);
    const [treasuryCredits, setTreasuryCredits] = useState<TreasuryCredit[]>([]);
    // null = not yet fetched; Record<storeId, actualBalance> once loaded
    const [balanceMap, setBalanceMap] = useState<Record<string, number> | null>(null);
    // Record<storeId, reservedAmount> — sum of active treasury_reservations per store
    const [reservedMap, setReservedMap] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { filters, setFilter } = useDashboardFilters();

    // ── Fetch stores + all cluster expenses ──────────────────────────────────
    useEffect(() => {
        if (!user?.cluster_id) return;
        setLoading(true);

        supabase
            .from("stores")
            .select("id, name, monthly_limit")
            .eq("cluster_id", user.cluster_id)
            .then(async ({ data: storeRows, error: storeErr }) => {
                if (storeErr) { setError(storeErr.message); setLoading(false); return; }
                const rows = (storeRows ?? []) as StoreRow[];
                setStores(rows);

                const storeIds = rows.map((s) => s.id);
                if (storeIds.length === 0) { setExpenses([]); setLoading(false); return; }

                // Fetch expenses + available balances + recent credits in parallel
                const [expResult, balances, creditsResult] = await Promise.all([
                    supabase
                        .from("expenses")
                        .select(
                            "id, amount, status, expense_month, created_at, receipt_url, store_id, " +
                            "stores(name, monthly_limit), categories(name)"
                        )
                        .in("store_id", storeIds)
                        .order("created_at", { ascending: false }),
                    getClusterAvailableBalances(storeIds),
                    supabase
                        .from("cash_transactions")
                        .select("id, store_id, amount, remarks, created_at, stores(name)")
                        .in("store_id", storeIds)
                        .eq("type", "credit")
                        .order("created_at", { ascending: false })
                        .limit(10),
                ]);

                setLoading(false);

                if (expResult.error) { setError(expResult.error.message); return; }

                const normalised = ((expResult.data ?? []) as any[]).map((row) => ({
                    ...row,
                    stores: normaliseJoin(row.stores),
                    categories: normaliseJoin(row.categories),
                })) as Expense[];
                setExpenses(normalised);

                // Build actual balance and reservation lookup maps
                const actualMap: Record<string, number> = {};
                const resMap: Record<string, number> = {};
                balances.forEach(({ storeId, actualBalance, reservedAmount }) => {
                    actualMap[storeId] = actualBalance;
                    resMap[storeId] = reservedAmount;
                });
                setBalanceMap(actualMap);
                setReservedMap(resMap);

                if (!creditsResult.error) {
                    const storeNameMap: Record<string, string> = {};
                    rows.forEach((s) => { storeNameMap[s.id] = s.name; });
                    const credits = ((creditsResult.data ?? []) as any[]).map((row) => ({
                        id: row.id,
                        store_id: row.store_id,
                        amount: row.amount,
                        remarks: row.remarks ?? null,
                        created_at: row.created_at,
                        storeName: storeNameMap[row.store_id] ?? row.store_id,
                    }));
                    setTreasuryCredits(credits);
                }
            });
    }, [user?.cluster_id]);

    // ── Fetch 6-month approved trend ─────────────────────────────────────────
    useEffect(() => {
        if (!user?.cluster_id) return;
        const sixAgo = new Date();
        sixAgo.setMonth(sixAgo.getMonth() - 5);
        sixAgo.setDate(1);

        supabase
            .from("stores")
            .select("id")
            .eq("cluster_id", user.cluster_id)
            .then(({ data: storeRows }) => {
                const storeIds = (storeRows ?? []).map((s) => s.id as string);
                if (storeIds.length === 0) return;
                supabase
                    .from("expenses")
                    .select("amount, expense_month, created_at, status, store_id")
                    .in("store_id", storeIds)
                    .in("status", APPROVED_STATUSES)
                    .gte("created_at", sixAgo.toISOString())
                    .then(({ data }) => {
                        if (!data) return;
                        setRawTrendData(data as any);
                    });
            });
    }, [user?.cluster_id]);

    // ── Apply Filters ─────────────────────────────────────────────────────────

    // 1. Current State Filtering (Ignores Date Range)
    //    Health is evaluated against availableBalance (= actual − reserved)
    const activeStoreIds = useMemo(() => {
        return stores.filter((s) => {
            if (filters.selectedStores.length > 0 && !filters.selectedStores.includes(s.id)) return false;
            if (filters.treasuryHealth.length > 0) {
                const actual = balanceMap ? balanceMap[s.id] ?? 0 : 0;
                const reserved = reservedMap[s.id] ?? 0;
                const health = getCashHealth(actual - reserved, s.monthly_limit);
                if (!filters.treasuryHealth.includes(health)) return false;
            }
            return true;
        }).map((s) => s.id);
    }, [stores, filters.selectedStores, filters.treasuryHealth, balanceMap, reservedMap]);

    // 2. Time-Scoped Analytics Filtering (Respects Date Range & Stores)
    const filteredExpenses = useMemo(() => {
        return expenses.filter((e) => {
            if (!activeStoreIds.includes(e.store_id)) return false;
            return isDateInRange(e.created_at, filters.dateRange);
        });
    }, [expenses, activeStoreIds, filters.dateRange]);

    const filteredCredits = useMemo(() => {
        return treasuryCredits.filter((c) => {
            if (!activeStoreIds.includes(c.store_id)) return false;
            return isDateInRange(c.created_at, filters.dateRange);
        });
    }, [treasuryCredits, activeStoreIds, filters.dateRange]);

    // 3. Trend Data Filtering (Ignores Date Range, Respects Stores)
    const trendData = useMemo(() => {
        const map: Record<string, number> = {};
        rawTrendData.forEach((e) => {
            if (!activeStoreIds.includes(e.store_id)) return;
            const key = e.expense_month
                ? (e.expense_month as string).slice(0, 7)
                : monthKey((e.created_at) ?? "");
            map[key] = (map[key] ?? 0) + (e.amount);
        });
        const months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(); d.setMonth(d.getMonth() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            months.push({ month: monthLabel(key), amount: map[key] ?? 0 });
        }
        return months;
    }, [rawTrendData, activeStoreIds]);

    // ── Derived: expense buckets ──────────────────────────────────────────────

    const approved = useMemo(() => filteredExpenses.filter((e) => APPROVED_STATUSES.includes(e.status)), [filteredExpenses]);
    const pending = useMemo(() => filteredExpenses.filter((e) => (PENDING_STATUSES as readonly string[]).includes(e.status)), [filteredExpenses]);
    const rejected = useMemo(() => filteredExpenses.filter((e) => REJECTED_STATUSES.includes(e.status)), [filteredExpenses]);
    const submitted = useMemo(() => filteredExpenses.filter((e) => SUBMITTED_STATUSES.includes(e.status)), [filteredExpenses]);
    const acctPend = useMemo(() => filteredExpenses.filter((e) => ACCT_PENDING.includes(e.status)), [filteredExpenses]);
    const clRejected = useMemo(() => filteredExpenses.filter((e) => e.status === "cluster_rejected"), [filteredExpenses]);

    const totalApproved = useMemo(() => sumAmount(approved), [approved]);
    const totalPending = useMemo(() => sumAmount(pending), [pending]);
    const totalRejected = useMemo(() => sumAmount(rejected), [rejected]);
    const largestExpense = useMemo(
        () => (filteredExpenses.length ? Math.max(...filteredExpenses.map((e) => e.amount)) : 0),
        [filteredExpenses]
    );
    const storeCount = useMemo(() => activeStoreIds.length, [activeStoreIds]);

    // ── Derived: per-store treasury positions (Current state + filtered analytics)

    const storeTreasuryPositions = useMemo<StoreTreasuryPosition[]>(() => {
        if (balanceMap === null) return [];

        const posMap: Record<string, StoreTreasuryPosition> = {};

        // Seed from ACTIVE stores only
        stores.filter(s => activeStoreIds.includes(s.id)).forEach((s) => {
            const actual = balanceMap[s.id] ?? 0;
            const reserved = reservedMap[s.id] ?? 0;
            posMap[s.id] = {
                storeId: s.id,
                name: s.name,
                targetFloat: s.monthly_limit ?? 0,
                balance: actual,
                reservedAmount: reserved,
                availableBalance: actual - reserved,
                pendingAmount: 0,
                pendingCount: 0,
                approved: 0,
                rejected: 0,
                expenseCount: 0,
                oldestSubmittedAt: null,
            };
        });

        // Accumulate expense data from filtered expenses
        filteredExpenses.forEach((e) => {
            const pos = posMap[e.store_id];
            if (!pos) return;
            pos.expenseCount++;
            if (APPROVED_STATUSES.includes(e.status)) pos.approved += e.amount;
            if ((PENDING_STATUSES as readonly string[]).includes(e.status)) {
                pos.pendingAmount += e.amount;
                pos.pendingCount++;
            }
            if (REJECTED_STATUSES.includes(e.status)) pos.rejected += e.amount;
            if (e.status === "submitted") {
                const t = new Date(e.created_at).getTime();
                if (pos.oldestSubmittedAt === null || t < pos.oldestSubmittedAt) {
                    pos.oldestSubmittedAt = t;
                }
            }
        });

        return Object.values(posMap).sort((a, b) => a.availableBalance - b.availableBalance); // worst first
    }, [stores, activeStoreIds, filteredExpenses, balanceMap, reservedMap]);

    // ── Treasury KPI aggregates ───────────────────────────────────────────────

    // Primary liquidity = sum of available balances (actual − reserved per store)
    const clusterLiquidity = useMemo(
        () => storeTreasuryPositions.reduce((s, p) => s + p.availableBalance, 0),
        [storeTreasuryPositions]
    );

    // Total actual balance — used as denominator for exposure % calculations
    const totalActualLiquidity = useMemo(
        () => storeTreasuryPositions.reduce((s, p) => s + p.balance, 0),
        [storeTreasuryPositions]
    );

    // Stores where availableBalance health is not "healthy"
    const storesAtRisk = useMemo(
        () => storeTreasuryPositions.filter(
            (p) => getCashHealth(p.availableBalance, p.targetFloat) !== "healthy"
        ).length,
        [storeTreasuryPositions]
    );

    // Refill needed is based on availableBalance vs targetFloat
    const totalRefillNeeded = useMemo(
        () => storeTreasuryPositions.reduce(
            (s, p) => s + getRefillRecommendation(p.availableBalance, p.targetFloat), 0
        ),
        [storeTreasuryPositions]
    );

    // Total pending exposure as % of actual cluster balance
    const pendingExposurePct = useMemo<number | null>(() => {
        if (totalActualLiquidity <= 0) return null;
        return (totalPending / totalActualLiquidity) * 100;
    }, [totalPending, totalActualLiquidity]);

    // ── Attention flags ───────────────────────────────────────────────────────

    // Negative / low based on availableBalance — the real operational signal
    const negativeStores = useMemo(
        () => storeTreasuryPositions.filter((p) => p.availableBalance < 0),
        [storeTreasuryPositions]
    );

    const lowLiquidityStores = useMemo(
        () => storeTreasuryPositions.filter(
            (p) => p.availableBalance >= 0 && getCashHealth(p.availableBalance, p.targetFloat) === "low"
        ),
        [storeTreasuryPositions]
    );

    // Stores where pending (expense-derived) > 50% of actual balance
    const highExposureStores = useMemo(
        () => storeTreasuryPositions.filter(
            (p) => p.balance > 0 && p.pendingAmount / p.balance > 0.5
        ),
        [storeTreasuryPositions]
    );

    // Stores with oldest submitted expense > 5 days
    const bottleneckStores = useMemo(
        () => storeTreasuryPositions
            .filter((p) => p.oldestSubmittedAt !== null &&
                Date.now() - p.oldestSubmittedAt > 5 * 24 * 60 * 60 * 1000)
            .map((p) => ({
                ...p,
                oldestDays: Math.floor((Date.now() - p.oldestSubmittedAt!) / (1000 * 60 * 60 * 24)),
            }))
            .sort((a, b) => b.oldestDays - a.oldestDays),
        [storeTreasuryPositions]
    );

    const hasAttentionItems =
        negativeStores.length > 0 ||
        lowLiquidityStores.length > 0 ||
        highExposureStores.length > 0 ||
        bottleneckStores.length > 0;

    // ── Approval aging (all submitted expenses > 5 days) ─────────────────────

    const agingApprovals = useMemo(
        () => submitted
            .filter((e) => daysAgo(e.created_at) >= 5)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
        [submitted]
    );

    // ── Chart data (existing derivations preserved) ───────────────────────────

    const storeBreakdown = useMemo(() => {
        const map: Record<string, {
            name: string; monthly_limit: number;
            approved: number; pending: number; rejected: number; count: number;
        }> = {};
        filteredExpenses.forEach((e) => {
            const sid = e.store_id;
            if (!map[sid]) {
                map[sid] = {
                    name: e.stores?.name ?? sid,
                    monthly_limit: e.stores?.monthly_limit ?? 0,
                    approved: 0, pending: 0, rejected: 0, count: 0,
                };
            }
            map[sid].count++;
            if (APPROVED_STATUSES.includes(e.status)) map[sid].approved += e.amount;
            if ((PENDING_STATUSES as readonly string[]).includes(e.status)) map[sid].pending += e.amount;
            if (REJECTED_STATUSES.includes(e.status)) map[sid].rejected += e.amount;
        });
        return Object.values(map).sort((a, b) => b.approved - a.approved);
    }, [filteredExpenses]);

    const topStoresChart = useMemo(
        () => storeBreakdown.slice(0, 8).map((s) => ({ name: s.name, value: s.approved })),
        [storeBreakdown]
    );

    const categoryData = useMemo(() => {
        const map: Record<string, number> = {};
        approved.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            map[k] = (map[k] ?? 0) + e.amount;
        });
        return Object.entries(map).map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value).slice(0, 8);
    }, [approved]);

    const rejectionByCategory = useMemo(() => {
        const map: Record<string, { count: number; total: number }> = {};
        rejected.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            if (!map[k]) map[k] = { count: 0, total: 0 };
            map[k].count++; map[k].total += e.amount;
        });
        return Object.entries(map).map(([name, v]) => ({ name, ...v }))
            .sort((a, b) => b.count - a.count).slice(0, 6);
    }, [rejected]);

    const rejectionByStore = useMemo(
        () => storeBreakdown.filter((s) => s.rejected > 0)
            .map((s) => ({ name: s.name, rejected: s.rejected }))
            .sort((a, b) => b.rejected - a.rejected).slice(0, 6),
        [storeBreakdown]
    );

    const highRejectionStores = useMemo(() => {
        const rejCountMap: Record<string, number> = {};
        const totalCountMap: Record<string, number> = {};
        filteredExpenses.forEach((e) => {
            totalCountMap[e.store_id] = (totalCountMap[e.store_id] ?? 0) + 1;
            if (REJECTED_STATUSES.includes(e.status))
                rejCountMap[e.store_id] = (rejCountMap[e.store_id] ?? 0) + 1;
        });
        return storeBreakdown.filter((s) => {
            const sid = filteredExpenses.find((e) => e.stores?.name === s.name)?.store_id ?? "";
            const rej = rejCountMap[sid] ?? 0;
            const tot = totalCountMap[sid] ?? 0;
            return tot >= 3 && rej / tot > 0.3;
        });
    }, [storeBreakdown, filteredExpenses]);

    const storeComparisonChart = useMemo(
        () => storeBreakdown.slice(0, 7).map((s) => ({
            name: s.name.length > 12 ? s.name.slice(0, 12) + "…" : s.name,
            Approved: s.approved, Pending: s.pending, Rejected: s.rejected,
        })),
        [storeBreakdown]
    );

    // ── Guards ───────────────────────────────────────────────────────────────

    if (authLoading) return <PageShell><LoadingState /></PageShell>;
    if (!user || user.role !== "cluster_manager") {
        return (
            <PageShell>
                <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
                    <ShieldAlert className="w-10 h-10 text-slate-300" />
                    <p className="font-medium">Access restricted to Cluster Managers.</p>
                </div>
            </PageShell>
        );
    }
    if (error) return <PageShell><p className="text-red-500 p-6 text-sm">{error}</p></PageShell>;

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────

    return (
        <PageShell>

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cluster Report</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Regional treasury monitoring across all stores in your cluster
                    </p>
                </div>
            </div>

            <DashboardFilterBar filters={filters} setFilter={setFilter} stores={stores} />

            {/* ══════════════════════════════════════════════════════════════════
                SECTION A — Treasury KPIs (ledger-driven)
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Overview" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
                <StatCard
                    icon={<Landmark className="w-4 h-4 text-indigo-600" />} bg="bg-indigo-50"
                    label="Available Liquidity"
                    value={formatCurrency(clusterLiquidity)}
                    sub="Available balance, active stores"
                    subColor={clusterLiquidity < 0 ? "text-red-600" : "text-slate-400"}
                />
                <StatCard
                    icon={<ShieldAlert className="w-4 h-4 text-red-500" />} bg="bg-red-50"
                    label="Stores at Risk"
                    value={String(storesAtRisk)}
                    sub={storesAtRisk > 0 ? "Low or negative balance" : "All stores healthy"}
                    subColor={storesAtRisk > 0 ? "text-red-600" : "text-emerald-600"}
                />
                <StatCard
                    icon={<RefreshCw className="w-4 h-4 text-amber-600" />} bg="bg-amber-50"
                    label="Total Refill Needed"
                    value={totalRefillNeeded > 0 ? formatCurrency(totalRefillNeeded) : "None"}
                    sub="To restore all stores to float"
                    subColor={totalRefillNeeded > 0 ? "text-amber-600" : "text-emerald-600"}
                />
                <StatCard
                    icon={<Clock className="w-4 h-4 text-orange-500" />} bg="bg-orange-50"
                    label="Pending Exposure"
                    value={pendingExposurePct !== null ? `${pendingExposurePct.toFixed(0)}%` : "—"}
                    sub={`${formatCurrency(totalPending)} of cluster cash`}
                    subColor={
                        pendingExposurePct !== null && pendingExposurePct > 60
                            ? "text-red-600"
                            : pendingExposurePct !== null && pendingExposurePct > 35
                                ? "text-amber-600"
                                : "text-slate-400"
                    }
                />
                <StatCard
                    icon={<ArrowUpCircle className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50"
                    label="Recent Top-Ups"
                    value={String(filteredCredits.length)}
                    sub="Credit events fetched"
                />
                <StatCard
                    icon={<Store className="w-4 h-4 text-cyan-600" />} bg="bg-cyan-50"
                    label="Stores in Cluster"
                    value={String(storeCount)}
                />
            </div>

            {/* ── Legacy approval KPIs row (preserved) ─────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                <StatCard
                    icon={<Activity className="w-4 h-4 text-blue-500" />} bg="bg-blue-50"
                    label="Submitted (Awaiting You)" value={String(submitted.length)}
                    sub={formatCurrency(sumAmount(submitted))} subColor="text-blue-600" />
                <StatCard
                    icon={<CheckCircle2 className="w-4 h-4 text-teal-500" />} bg="bg-teal-50"
                    label="Approved" value={String(acctPend.length)}
                    sub="Awaiting accounting record" subColor="text-teal-600" />
                <StatCard
                    icon={<XCircle className="w-4 h-4 text-orange-500" />} bg="bg-orange-50"
                    label="Cluster Rejected" value={String(clRejected.length)}
                    sub={formatCurrency(sumAmount(clRejected))} subColor="text-orange-600" />
                <StatCard
                    icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50"
                    label="Fully Approved" value={String(approved.length)}
                    sub={formatCurrency(totalApproved)} subColor="text-emerald-600" />
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION B — Attention Required
                Only rendered when there are items needing intervention.
            ══════════════════════════════════════════════════════════════════ */}
            {hasAttentionItems && (
                <>
                    <SectionHeading title="Attention Required" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

                        {/* Liquidity alerts */}
                        {(negativeStores.length > 0 || lowLiquidityStores.length > 0) && (
                            <Card className="rounded-xl border border-red-200 shadow-sm overflow-hidden"
                                style={{ backgroundColor: "rgba(254,242,242,0.4)" }}>
                                <div className="flex items-center gap-2 px-5 py-4 border-b border-red-100">
                                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    <p className="text-sm font-semibold text-slate-700">Liquidity Alerts</p>
                                    <span className="ml-auto text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                                        {negativeStores.length + lowLiquidityStores.length} store{negativeStores.length + lowLiquidityStores.length !== 1 ? "s" : ""}
                                    </span>
                                </div>
                                <div className="divide-y divide-red-50">
                                    {negativeStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-red-600 mt-0.5">Negative available balance</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-red-600 tabular-nums">{formatCurrency(p.availableBalance)}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">Refill: {formatCurrency(getRefillRecommendation(p.availableBalance, p.targetFloat))}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {lowLiquidityStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-amber-600 mt-0.5">Low available cash — below 25% of float</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-amber-600 tabular-nums">{formatCurrency(p.availableBalance)}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">Refill: {formatCurrency(getRefillRecommendation(p.availableBalance, p.targetFloat))}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {/* High exposure + bottleneck alerts */}
                        {(highExposureStores.length > 0 || bottleneckStores.length > 0) && (
                            <Card className="rounded-xl border border-amber-200 shadow-sm overflow-hidden"
                                style={{ backgroundColor: "rgba(254,243,199,0.25)" }}>
                                <div className="flex items-center gap-2 px-5 py-4 border-b border-amber-100">
                                    <Zap className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                    <p className="text-sm font-semibold text-slate-700">Operational Flags</p>
                                </div>
                                <div className="divide-y divide-amber-50">
                                    {highExposureStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-amber-700 mt-0.5">
                                                    High pending exposure — {((p.pendingAmount / p.balance) * 100).toFixed(0)}% of cash locked
                                                </p>
                                            </div>
                                            <p className="text-sm font-bold text-amber-600 tabular-nums">{formatCurrency(p.pendingAmount)}</p>
                                        </div>
                                    ))}
                                    {bottleneckStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-orange-600 mt-0.5">
                                                    Approval stalled — oldest submission {p.oldestDays}d ago
                                                </p>
                                            </div>
                                            <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                                                {p.pendingCount} pending
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                    </div>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                SECTION C — Treasury Risk Matrix
                One row per store with live ledger balance + health + refill.
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Treasury Risk Matrix" />
            <Card className="rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div>
                        <p className="text-sm font-semibold text-slate-700">Store Positions</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Ledger balance · treasury health · refill required · sorted by liquidity
                        </p>
                    </div>
                    {balanceMap === null && (
                        <span className="text-xs text-slate-400 italic">Loading balances…</span>
                    )}
                </div>
                {storeTreasuryPositions.length === 0 ? (
                    <div className="flex items-center justify-center h-28 text-slate-400 text-sm">
                        {loading ? "Loading…" : "No store data."}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    {["Store", "Available Balance", "Treasury Health", "Pending", "Refill Needed", "Status"].map((h) => (
                                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {storeTreasuryPositions.map((pos, i) => {
                                    const refill = getRefillRecommendation(pos.availableBalance, pos.targetFloat);
                                    const health = getCashHealth(pos.availableBalance, pos.targetFloat);
                                    const isNeg = pos.availableBalance < 0;
                                    return (
                                        <tr key={pos.storeId}
                                            className={`border-b border-slate-50 transition-colors ${isNeg ? "bg-red-50/30 hover:bg-red-50/50"
                                                : health === "low" ? "bg-amber-50/20 hover:bg-amber-50/40"
                                                    : i % 2 === 0 ? "bg-white hover:bg-slate-50/70"
                                                        : "bg-slate-50/30 hover:bg-slate-50/70"
                                                }`}>
                                            <td className="px-5 py-3 font-medium text-slate-800 whitespace-nowrap">{pos.name}</td>
                                            <td className="px-5 py-3 whitespace-nowrap">
                                                <p className={`font-bold tabular-nums ${isNeg ? "text-red-600" : "text-slate-900"}`}>
                                                    {formatCurrency(pos.availableBalance)}
                                                </p>
                                                {pos.reservedAmount > 0 && (
                                                    <p className="text-xs text-amber-600 mt-0.5 tabular-nums">
                                                        {formatCurrency(pos.reservedAmount)} reserved
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">
                                                <HealthBadge balance={pos.availableBalance} targetFloat={pos.targetFloat} />
                                            </td>
                                            <td className="px-5 py-3 text-slate-600 tabular-nums">
                                                {pos.pendingCount > 0 ? (
                                                    <span>
                                                        <span className="font-semibold text-amber-700">{pos.pendingCount}</span>
                                                        <span className="text-slate-400"> · {formatCurrency(pos.pendingAmount)}</span>
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300">—</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 tabular-nums">
                                                {refill ? (
                                                    <span className="font-semibold text-amber-700">{formatCurrency(refill)}</span>
                                                ) : (
                                                    <span className="text-emerald-600 font-medium text-xs">Sufficient</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">
                                                {pos.oldestSubmittedAt !== null && Date.now() - pos.oldestSubmittedAt > 5 * 24 * 60 * 60 * 1000 ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                                                        <Clock className="w-3 h-3" /> Stalled
                                                    </span>
                                                ) : pos.availableBalance >= 0 && !refill ? (
                                                    <span className="text-xs text-emerald-600 font-medium">Operational</span>
                                                ) : (
                                                    <span className="text-xs text-slate-400">Active</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION D — Approval Bottlenecks + Recent Treasury Top-Ups
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Bottlenecks &amp; Treasury Activity" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

                {/* Aging approvals > 5 days */}
                <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-orange-500 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-slate-700">Aging Approvals</p>
                                <p className="text-xs text-slate-400 mt-0.5">Submitted expenses pending 5+ days</p>
                            </div>
                        </div>
                        {agingApprovals.length > 0 && (
                            <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full flex-shrink-0">
                                {agingApprovals.length}
                            </span>
                        )}
                    </div>
                    {agingApprovals.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
                            <CheckCircle2 className="w-7 h-7 text-emerald-300" />
                            <p className="text-sm font-medium">No stalled approvals</p>
                            <p className="text-xs text-slate-300">All submissions reviewed within 5 days</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Store", "Amount", "Age", "Status"].map((h) => (
                                            <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {agingApprovals.slice(0, 8).map((e, i) => {
                                        const days = daysAgo(e.created_at);
                                        return (
                                            <tr key={e.id}
                                                className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                <td className="px-5 py-3 font-medium text-slate-700 whitespace-nowrap">{e.stores?.name ?? "—"}</td>
                                                <td className="px-5 py-3 font-semibold text-slate-900 tabular-nums">{formatCurrency(e.amount)}</td>
                                                <td className="px-5 py-3">
                                                    <span className={`text-xs font-bold ${days >= 7 ? "text-red-600" : "text-orange-600"}`}>
                                                        {days}d
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3"><Badge status={e.status as never} /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                {/* Recent treasury credits */}
                <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
                        <ArrowDownCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-slate-700">Recent Treasury Top-Ups</p>
                            <p className="text-xs text-slate-400 mt-0.5">Latest credit transactions across cluster</p>
                        </div>
                    </div>
                    {filteredCredits.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
                            <Landmark className="w-7 h-7 text-slate-200" />
                            <p className="text-sm font-medium">No recent top-ups</p>
                            <p className="text-xs text-slate-300">No credit transactions on record</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {filteredCredits.map((credit) => (
                                <div key={credit.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors">
                                    <div className="min-w-0 mr-4">
                                        <p className="text-sm font-medium text-slate-800 truncate">{credit.storeName}</p>
                                        {credit.remarks && (
                                            <p className="text-xs text-slate-400 mt-0.5 truncate">{credit.remarks}</p>
                                        )}
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="text-sm font-bold text-emerald-700 tabular-nums">+{formatCurrency(credit.amount)}</p>
                                        <p className="text-xs text-slate-400 mt-0.5">{isoToLabel(credit.created_at)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION E — Spend Analytics (charts preserved from original)
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Spend Analytics" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Top Stores by Approved Spend</p>
                        <p className="text-xs text-slate-400 mt-0.5">Ranked by fully approved spend</p>
                    </div>
                    <div className="px-5 pb-5">
                        {topStoresChart.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={topStoresChart} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name"
                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                                    <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Card>

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Monthly Trend</p>
                        <p className="text-xs text-slate-400 mt-0.5">Cluster-wide approved spend, last 6 months</p>
                    </div>
                    <div className="px-5 pb-5">
                        {trendData.every((d) => d.amount === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <LineChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={36} />
                                    <Tooltip formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                                    <Line type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2.5}
                                        dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION F — Store & Category Breakdown (preserved)
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Store &amp; Category Breakdown" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Store Comparison</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved · Pending · Rejected per store</p>
                    </div>
                    <div className="px-5 pb-5">
                        {storeComparisonChart.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={storeComparisonChart} barSize={7}
                                    margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={36} />
                                    <Tooltip formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                                    <Legend iconType="circle" iconSize={7}
                                        formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
                                    <Bar dataKey="Approved" fill="#22c55e" radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="Rejected" fill="#ef4444" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Card>

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Spend by Category</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved expenses across all cluster stores</p>
                    </div>
                    <div className="px-5 pb-5">
                        {categoryData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={categoryData} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name"
                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                        {categoryData.map((_, i) => (
                                            <Cell key={i} fill={`hsl(${240 + i * 22}, 65%, ${58 - i * 3}%)`} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION G — Store Detail Table (preserved)
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Store Detail" />
            <Card className="rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-700">All Stores</p>
                    <p className="text-xs text-slate-400 mt-0.5">{storeBreakdown.length} store{storeBreakdown.length !== 1 ? "s" : ""} in cluster</p>
                </div>
                {loading ? (
                    <div className="flex items-center justify-center h-28 text-slate-400 text-sm">Loading…</div>
                ) : storeBreakdown.length === 0 ? (
                    <div className="flex items-center justify-center h-28 text-slate-400 text-sm">No store data.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    {["Store", "Approved", "Pending", "Rejected", "Expenses"].map((h) => (
                                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {storeBreakdown.map((s, i) => (
                                    <tr key={s.name}
                                        className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                        <td className="px-5 py-3 font-medium text-slate-800">{s.name}</td>
                                        <td className="px-5 py-3 font-semibold text-emerald-700 tabular-nums">{formatCurrency(s.approved)}</td>
                                        <td className="px-5 py-3 font-semibold text-amber-600 tabular-nums">{formatCurrency(s.pending)}</td>
                                        <td className="px-5 py-3 font-semibold text-red-600 tabular-nums">{formatCurrency(s.rejected)}</td>
                                        <td className="px-5 py-3 text-slate-600 tabular-nums">{s.count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION H — Pending Approval Queue (preserved)
            ══════════════════════════════════════════════════════════════════ */}
            {submitted.length > 0 && (
                <>
                    <SectionHeading title="Pending Approval Queue" />
                    <Card className="rounded-xl border border-amber-200 shadow-sm mb-8 overflow-hidden"
                        style={{ backgroundColor: "rgba(254,243,199,0.15)" }}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100">
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold text-slate-700">Submitted — Awaiting Your Approval</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {formatCurrency(sumAmount(submitted))} total held · Requires your action
                                    </p>
                                </div>
                            </div>
                            <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full flex-shrink-0">
                                {submitted.length} expense{submitted.length !== 1 ? "s" : ""}
                            </span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-amber-50/60 border-b border-amber-100">
                                        {["Date", "Store", "Category", "Amount", "Status", "Receipt"].map((h) => (
                                            <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {submitted.map((e, i) => (
                                        <tr key={e.id}
                                            className={`border-b border-amber-50 hover:bg-amber-50/60 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-amber-50/20"}`}>
                                            <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                            <td className="px-5 py-3 text-slate-700 font-medium">{e.stores?.name ?? "—"}</td>
                                            <td className="px-5 py-3 text-slate-600">{e.categories?.name ?? "—"}</td>
                                            <td className="px-5 py-3 font-semibold text-slate-900 tabular-nums">{formatCurrency(e.amount)}</td>
                                            <td className="px-5 py-3"><Badge status={e.status as never} /></td>
                                            <td className="px-5 py-3">
                                                {e.receipt_url ? (
                                                    <a href={e.receipt_url} target="_blank" rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium transition-colors">
                                                        View <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                ) : (
                                                    <span className="text-slate-300 text-xs">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                SECTION I — Rejection Insights (preserved)
            ══════════════════════════════════════════════════════════════════ */}
            {rejected.length > 0 && (
                <>
                    <SectionHeading title="Rejection Insights" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

                        <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100">
                                <p className="text-sm font-semibold text-slate-700">Rejections by Category</p>
                                <p className="text-xs text-slate-400 mt-0.5">All rejection stages</p>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Category", "Count", "Amount"].map((h) => (
                                            <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rejectionByCategory.map((row, i) => (
                                        <tr key={row.name}
                                            className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                            <td className="px-5 py-3 font-medium text-slate-700">{row.name}</td>
                                            <td className="px-5 py-3">
                                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold">
                                                    {row.count}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 font-semibold text-slate-900 tabular-nums">{formatCurrency(row.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>

                        <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100">
                                <p className="text-sm font-semibold text-slate-700">Rejections by Store</p>
                                <p className="text-xs text-slate-400 mt-0.5">Stores with highest rejection totals</p>
                            </div>
                            {rejectionByStore.length === 0 ? (
                                <div className="flex items-center justify-center h-28 text-slate-300 text-sm">No data</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {["Store", "Rejected Amount"].map((h) => (
                                                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rejectionByStore.map((row, i) => (
                                            <tr key={row.name}
                                                className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                <td className="px-5 py-3 font-medium text-slate-700">{row.name}</td>
                                                <td className="px-5 py-3 font-semibold text-red-600 tabular-nums">{formatCurrency(row.rejected)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </Card>
                    </div>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                SECTION J — Approval Pipeline (preserved)
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Pipeline" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-1">
                        <p className="text-sm font-semibold text-slate-700">Expense Pipeline</p>
                        <p className="text-xs text-slate-400 mt-0.5">Cluster-wide breakdown by stage</p>
                    </div>
                    <div className="px-5 pb-2">
                        <PipelineStep label="Awaiting Your Approval" count={submitted.length}
                            amount={sumAmount(submitted)} color="#f59e0b" icon={<Clock className="w-4 h-4" />} />
                        <PipelineStep label="Approved (Accounting Recording)" count={acctPend.length}
                            amount={sumAmount(acctPend)} color="#14b8a6" icon={<CheckCircle2 className="w-4 h-4" />} />
                        <PipelineStep label="Fully Approved" count={approved.length}
                            amount={totalApproved} color="#22c55e" icon={<TrendingUp className="w-4 h-4" />} />
                        <PipelineStep label="Rejected" count={rejected.length}
                            amount={totalRejected} color="#ef4444" icon={<XCircle className="w-4 h-4" />} />
                    </div>
                </Card>

                {/* High-rejection store flag (preserved, budget-language removed) */}
                {highRejectionStores.length > 0 ? (
                    <Card className="rounded-xl border border-orange-200 shadow-sm"
                        style={{ backgroundColor: "rgba(255,247,237,0.5)" }}>
                        <div className="flex items-center gap-2 px-5 py-4 border-b border-orange-100">
                            <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" />
                            <p className="text-sm font-semibold text-slate-700">High Rejection Rate Stores</p>
                        </div>
                        <div className="divide-y divide-orange-50">
                            {highRejectionStores.map((s) => (
                                <div key={s.name} className="flex items-center justify-between px-5 py-3">
                                    <span className="text-sm font-medium text-slate-700">{s.name}</span>
                                    <span className="text-xs font-semibold text-orange-700">{formatCurrency(s.rejected)} rejected</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                ) : (
                    <Card className="rounded-xl border border-slate-200 shadow-sm">
                        <CardContent className="flex flex-col items-center justify-center h-full py-10 gap-2 text-slate-400">
                            <CheckCircle2 className="w-8 h-8 text-emerald-300" />
                            <p className="text-sm font-medium">No high-rejection stores</p>
                            <p className="text-xs text-slate-300">All stores within normal rejection rates</p>
                        </CardContent>
                    </Card>
                )}
            </div>

        </PageShell>
    );
}