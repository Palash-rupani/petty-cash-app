"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { ExpenseDrawer } from "@/components/expenses/ExpenseDrawer";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, compactCurrency } from "@/lib/utils/formatCurrency";
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
    Landmark, ArrowDownCircle, Zap, TrendingDown, Eye,
    BarChart3, PieChart, Target,
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

interface StoreTreasuryPosition {
    storeId: string;
    name: string;
    targetFloat: number;
    balance: number;
    reservedAmount: number;
    availableBalance: number;
    pendingAmount: number;
    pendingCount: number;
    approved: number;
    rejected: number;
    expenseCount: number;
    oldestSubmittedAt: number | null;
}

import { normalizeExpenseStatus } from "@/types";

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

// ─── Treasury Health Badge ────────────────────────────────────────────────────

function TreasuryHealthBadge({ balance, targetFloat }: { balance: number; targetFloat: number }) {
    const health = getCashHealth(balance, targetFloat);
    const config = {
        healthy: { label: "Stable", dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
        low: { label: "Monitor", dot: "bg-amber-500", cls: "bg-amber-50 text-amber-700 border-amber-200" },
        negative: { label: "Critical", dot: "bg-red-500", cls: "bg-red-50 text-red-700 border-red-200" },
    } as const;
    const { label, dot, cls } = config[health];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
            {label}
        </span>
    );
}

// ─── Page Components ──────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="px-6 py-8 max-w-7xl mx-auto">{children}</div>;
}

function SectionHeading({ title, icon, subtitle }: { title: string; icon?: React.ReactNode; subtitle?: string }) {
    return (
        <div className="flex items-start gap-3 mb-5 mt-3">
            {icon && <div className="text-slate-400 mt-0.5">{icon}</div>}
            <div className="flex-1">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">
                    {title}
                </h2>
                {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
            </div>
        </div>
    );
}

function kpiValueSize(value: string): string {
    const n = value.length
    if (n <= 4) return 'text-3xl'
    if (n <= 7) return 'text-2xl'
    return 'text-xl'
}

function TreasuryStatCard({
    icon, bg, label, value, sub, subColor = "text-slate-400", trend,
}: {
    icon: React.ReactNode; bg: string; label: string;
    value: string; sub?: string; subColor?: string; trend?: "up" | "down" | "neutral";
}) {
    return (
        <Card className="rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 lg:p-6 flex flex-col gap-3">
                {/* Label row: label left, icon + trend indicator right */}
                <div className="flex items-start justify-between gap-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] leading-snug">{label}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {trend && (
                            <span>
                                {trend === "up" && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
                                {trend === "down" && <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
                                {trend === "neutral" && <Zap className="w-3.5 h-3.5 text-slate-300" />}
                            </span>
                        )}
                        <div className={`p-2 rounded-xl ${bg} flex-shrink-0`}>{icon}</div>
                    </div>
                </div>
                {/* Value — full size, never clipped */}
                <div>
                    <p className={`font-bold text-slate-900 tabular-nums leading-none ${kpiValueSize(value)}`}>{value}</p>
                    {sub && <p className={`text-xs mt-1.5 font-medium leading-snug ${subColor}`}>{sub}</p>}
                </div>
            </CardContent>
        </Card>
    );
}

function RiskIndicator({
    label, value, alert, color = "slate",
}: {
    label: string; value: string | number; alert?: boolean; color?: "red" | "amber" | "slate" | "emerald";
}) {
    const colorMap = {
        red: "bg-red-50 border-red-200 text-red-900",
        amber: "bg-amber-50 border-amber-200 text-amber-900",
        slate: "bg-slate-50 border-slate-200 text-slate-700",
        emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    };
    return (
        <div className={`rounded-lg border p-3 ${colorMap[color]}`}>
            <p className="text-xs font-medium opacity-75">{label}</p>
            <p className={`text-lg font-bold mt-1 ${alert ? "text-red-700" : ""}`}>{value}</p>
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
            <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-5">
                {[...Array(6)].map((_, i) => <div key={i} className="h-[110px] bg-slate-100 rounded-2xl" />)}
            </div>
            <div className="h-48 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-56 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="h-64 bg-slate-100 rounded-xl" />
        </div>
    );
}

// ─── Main Treasury Intelligence Dashboard ─────────────────────────────────────

export default function ClusterTreasuryDashboard() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [stores, setStores] = useState<StoreRow[]>([]);
    const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [rawTrendData, setRawTrendData] = useState<{ amount: number, expense_month: string | null, created_at: string, status: string, store_id: string }[]>([]);
    const [treasuryCredits, setTreasuryCredits] = useState<TreasuryCredit[]>([]);
    const [balanceMap, setBalanceMap] = useState<Record<string, number> | null>(null);
    const [reservedMap, setReservedMap] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { filters, setFilter } = useDashboardFilters();

    // ── Data Fetching ──────────────────────────────────────────────────────
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

    // ── 6-Month Trend ──────────────────────────────────────────────────────
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
                    // Historical wide-net: catches all legacy + current approved states
                    // for complete 6-month trend coverage. normalizeExpenseStatus()
                    // is applied in the trendData useMemo to filter down to 'approved' only.
                    .in("status", ["approved", "accounting_approved", "synced_to_tally", "cluster_approved"])
                    .gte("created_at", sixAgo.toISOString())
                    .then(({ data }) => {
                        if (!data) return;
                        setRawTrendData(data as any);
                    });
            });
    }, [user?.cluster_id]);

    // ── Filtering Logic ────────────────────────────────────────────────────

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

    // ── Expense Status Buckets ─────────────────────────────────────────────

    const approved = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "approved"), [filteredExpenses]);
    const pending = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "submitted"), [filteredExpenses]);
    const rejected = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "rejected"), [filteredExpenses]);
    const submitted = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "submitted"), [filteredExpenses]);

    const totalApproved = useMemo(() => sumAmount(approved), [approved]);
    const totalPending = useMemo(() => sumAmount(pending), [pending]);
    const totalRejected = useMemo(() => sumAmount(rejected), [rejected]);
    const storeCount = useMemo(() => activeStoreIds.length, [activeStoreIds]);

    // ── Treasury Positions ─────────────────────────────────────────────────

    const storeTreasuryPositions = useMemo<StoreTreasuryPosition[]>(() => {
        if (balanceMap === null) return [];

        const posMap: Record<string, StoreTreasuryPosition> = {};

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

        filteredExpenses.forEach((e) => {
            const pos = posMap[e.store_id];
            if (!pos) return;
            pos.expenseCount++;
            if (normalizeExpenseStatus(e.status as any) === "approved") pos.approved += e.amount;
            if (normalizeExpenseStatus(e.status as any) === "submitted") {
                pos.pendingAmount += e.amount;
                pos.pendingCount++;
            }
            if (normalizeExpenseStatus(e.status as any) === "rejected") pos.rejected += e.amount;
            if (normalizeExpenseStatus(e.status as any) === "submitted") {
                const t = new Date(e.created_at).getTime();
                if (pos.oldestSubmittedAt === null || t < pos.oldestSubmittedAt) {
                    pos.oldestSubmittedAt = t;
                }
            }
        });

        return Object.values(posMap).sort((a, b) => a.availableBalance - b.availableBalance);
    }, [stores, activeStoreIds, filteredExpenses, balanceMap, reservedMap]);

    // ── Treasury KPI Aggregates ────────────────────────────────────────────

    const clusterLiquidity = useMemo(
        () => storeTreasuryPositions.reduce((s, p) => s + p.availableBalance, 0),
        [storeTreasuryPositions]
    );

    const totalActualLiquidity = useMemo(
        () => storeTreasuryPositions.reduce((s, p) => s + p.balance, 0),
        [storeTreasuryPositions]
    );

    const totalReserved = useMemo(
        () => storeTreasuryPositions.reduce((s, p) => s + p.reservedAmount, 0),
        [storeTreasuryPositions]
    );

    const storesAtRisk = useMemo(
        () => storeTreasuryPositions.filter(
            (p) => getCashHealth(p.availableBalance, p.targetFloat) !== "healthy"
        ).length,
        [storeTreasuryPositions]
    );

    const totalRefillNeeded = useMemo(
        () => storeTreasuryPositions.reduce(
            (s, p) => s + getRefillRecommendation(p.availableBalance, p.targetFloat), 0
        ),
        [storeTreasuryPositions]
    );

    const pendingExposurePct = useMemo<number | null>(() => {
        if (totalActualLiquidity <= 0) return null;
        return (totalPending / totalActualLiquidity) * 100;
    }, [totalPending, totalActualLiquidity]);

    const liquidityCoverageRatio = useMemo(() => {
        if (totalApproved === 0) return null;
        return (clusterLiquidity / totalApproved * 100);
    }, [clusterLiquidity, totalApproved]);

    // ── Risk Flags ─────────────────────────────────────────────────────────

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

    const highExposureStores = useMemo(
        () => storeTreasuryPositions.filter(
            (p) => p.balance > 0 && p.pendingAmount / p.balance > 0.5
        ),
        [storeTreasuryPositions]
    );

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

    // ── Aging Approvals ───────────────────────────────────────────────────

    const agingApprovals = useMemo(
        () => submitted
            .filter((e) => daysAgo(e.created_at) >= 5)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
        [submitted]
    );

    // ── Chart Data ─────────────────────────────────────────────────────────

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
            if (normalizeExpenseStatus(e.status as any) === "approved") map[sid].approved += e.amount;
            if (normalizeExpenseStatus(e.status as any) === "submitted") map[sid].pending += e.amount;
            if (normalizeExpenseStatus(e.status as any) === "rejected") map[sid].rejected += e.amount;
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

    const storeComparisonChart = useMemo(
        () => storeBreakdown.slice(0, 7).map((s) => ({
            name: s.name.length > 12 ? s.name.slice(0, 12) + "…" : s.name,
            Approved: s.approved, Pending: s.pending, Rejected: s.rejected,
        })),
        [storeBreakdown]
    );

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

    // ── Guards ─────────────────────────────────────────────────────────────

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
    // RENDER — Treasury Intelligence Dashboard
    // ─────────────────────────────────────────────────────────────────────────

    return (
        <>
        <PageShell>

            {/* ══════════════════════════════════════════════════════════════════
                HEADER
            ══════════════════════════════════════════════════════════════════ */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <Landmark className="w-6 h-6 text-indigo-600" />
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Treasury Intelligence</h1>
                </div>
                <p className="text-sm text-slate-500 ml-9">
                    Cluster-wide liquidity monitoring, risk analytics, and treasury insights
                </p>
            </div>

            <DashboardFilterBar filters={filters} setFilter={setFilter} stores={stores} />

            {/* ══════════════════════════════════════════════════════════════════
                SECTION 1: EXECUTIVE TREASURY OVERVIEW
                Core liquidity KPIs focused on treasury metrics
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading
                title="Executive Overview"
                icon={<Eye className="w-4 h-4" />}
                subtitle="Cluster liquidity position, reserved exposure, and refill obligations"
            />
            <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-5 mb-10">
                <TreasuryStatCard
                    icon={<Landmark className="w-4 h-4 text-indigo-600" />}
                    bg="bg-indigo-50"
                    label="Available Liquidity"
                    value={compactCurrency(clusterLiquidity)}
                    sub="Operational cash"
                    subColor={clusterLiquidity < 0 ? "text-red-600" : "text-slate-400"}
                    trend={clusterLiquidity >= totalApproved ? "up" : clusterLiquidity < 0 ? "down" : "neutral"}
                />
                <TreasuryStatCard
                    icon={<Wallet className="w-4 h-4 text-cyan-600" />}
                    bg="bg-cyan-50"
                    label="Reserved Exposure"
                    value={compactCurrency(totalReserved)}
                    sub="Pending reservations"
                    subColor="text-slate-400"
                />
                <TreasuryStatCard
                    icon={<RefreshCw className="w-4 h-4 text-amber-600" />}
                    bg="bg-amber-50"
                    label="Refill Required"
                    value={totalRefillNeeded > 0 ? compactCurrency(totalRefillNeeded) : "None"}
                    sub="To restore floats"
                    subColor={totalRefillNeeded > 0 ? "text-amber-600" : "text-emerald-600"}
                    trend={totalRefillNeeded > 0 ? "down" : "up"}
                />
                <TreasuryStatCard
                    icon={<ShieldAlert className="w-4 h-4 text-red-500" />}
                    bg="bg-red-50"
                    label="Stores at Risk"
                    value={String(storesAtRisk)}
                    sub={storesAtRisk > 0 ? "Below target float" : "All stable"}
                    subColor={storesAtRisk > 0 ? "text-red-600" : "text-emerald-600"}
                    trend={storesAtRisk > 0 ? "down" : "up"}
                />
                <TreasuryStatCard
                    icon={<BarChart3 className="w-4 h-4 text-orange-600" />}
                    bg="bg-orange-50"
                    label="Pending Exposure"
                    value={pendingExposurePct !== null ? `${pendingExposurePct.toFixed(0)}%` : "—"}
                    sub={`${compactCurrency(totalPending)} locked`}
                    subColor={
                        pendingExposurePct !== null && pendingExposurePct > 60
                            ? "text-red-600"
                            : pendingExposurePct !== null && pendingExposurePct > 35
                                ? "text-amber-600"
                                : "text-slate-400"
                    }
                />
                <TreasuryStatCard
                    icon={<Store className="w-4 h-4 text-emerald-600" />}
                    bg="bg-emerald-50"
                    label="Cluster Stores"
                    value={String(storeCount)}
                    sub="Active monitored"
                    subColor="text-slate-400"
                />
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION 2: TREASURY RISK & STABILITY ALERTS
                Primary operational intelligence layer
            ══════════════════════════════════════════════════════════════════ */}
            {hasAttentionItems && (
                <>
                    <SectionHeading
                        title="Risk & Stability Alerts"
                        icon={<AlertTriangle className="w-4 h-4" />}
                        subtitle="Critical items requiring treasury intervention"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">

                        {/* Liquidity Crisis */}
                        {(negativeStores.length > 0 || lowLiquidityStores.length > 0) && (
                            <Card className="rounded-xl border-2 border-red-300 shadow-md overflow-hidden bg-gradient-to-br from-red-50 to-white">
                                <div className="flex items-center gap-2 px-5 py-4 border-b border-red-200 bg-red-50/60">
                                    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                                    <p className="text-sm font-bold text-slate-800">Liquidity Crisis</p>
                                    <span className="ml-auto text-xs font-bold text-white bg-red-600 px-2.5 py-1 rounded-full">
                                        {negativeStores.length + lowLiquidityStores.length}
                                    </span>
                                </div>
                                <div className="divide-y divide-red-100">
                                    {negativeStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3 bg-red-50/50 hover:bg-red-100/30">
                                            <div>
                                                <p className="text-sm font-bold text-slate-800">{p.name}</p>
                                                <p className="text-xs text-red-700 mt-0.5 font-semibold">⚠️ Negative balance — immediate action required</p>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <p className="text-sm font-bold text-red-700 tabular-nums">{formatCurrency(p.availableBalance)}</p>
                                                <p className="text-xs text-slate-500 mt-0.5 font-semibold">Inject: {formatCurrency(getRefillRecommendation(p.availableBalance, p.targetFloat))}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {lowLiquidityStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3 bg-amber-50/50 hover:bg-amber-100/30">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-amber-700 mt-0.5">Low cash — below 25% of target</p>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                                <p className="text-sm font-bold text-amber-700 tabular-nums">{formatCurrency(p.availableBalance)}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">Inject: {formatCurrency(getRefillRecommendation(p.availableBalance, p.targetFloat))}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}

                        {/* Operational Flags */}
                        {(highExposureStores.length > 0 || bottleneckStores.length > 0) && (
                            <Card className="rounded-xl border-2 border-amber-300 shadow-md overflow-hidden bg-gradient-to-br from-amber-50 to-white">
                                <div className="flex items-center gap-2 px-5 py-4 border-b border-amber-200 bg-amber-50/60">
                                    <Zap className="w-5 h-5 text-amber-600 flex-shrink-0" />
                                    <p className="text-sm font-bold text-slate-800">Operational Flags</p>
                                </div>
                                <div className="divide-y divide-amber-100">
                                    {highExposureStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3 hover:bg-amber-50/50">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-amber-700 mt-0.5 font-semibold">
                                                    High pending exposure — {((p.pendingAmount / p.balance) * 100).toFixed(0)}% of balance locked
                                                </p>
                                            </div>
                                            <p className="text-sm font-bold text-amber-700 tabular-nums flex-shrink-0">{formatCurrency(p.pendingAmount)}</p>
                                        </div>
                                    ))}
                                    {bottleneckStores.map((p) => (
                                        <div key={p.storeId} className="flex items-center justify-between px-5 py-3 hover:bg-orange-50/50">
                                            <div>
                                                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                                                <p className="text-xs text-orange-700 mt-0.5 font-semibold">Approval stalled — oldest {p.oldestDays}d ago</p>
                                            </div>
                                            <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2.5 py-1 rounded-full flex-shrink-0">
                                                {p.pendingCount} items
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
                SECTION 3: TREASURY POSITION ANALYTICS
                Per-store ledger balance, health, refill analysis
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading
                title="Treasury Position Matrix"
                icon={<Target className="w-4 h-4" />}
                subtitle="Store-by-store liquidity health, reserves, and refill recommendations"
            />
            <Card className="rounded-xl border border-slate-200 shadow-md mb-10 overflow-hidden">
                {storeTreasuryPositions.length === 0 ? (
                    <div className="flex items-center justify-center h-28 text-slate-400 text-sm py-8">
                        {loading ? "Loading…" : "No store data."}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    {["Store", "Available", "Reserved", "Health", "Pending", "Refill", "Ops Status"].map((h) => (
                                        <th key={h} className="text-left px-5 py-3 text-xs font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">{h}</th>
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
                                            className={`border-b border-slate-100 transition-colors ${isNeg ? "bg-red-50/40 hover:bg-red-50/60" :
                                                health === "low" ? "bg-amber-50/20 hover:bg-amber-50/40" :
                                                    i % 2 === 0 ? "bg-white hover:bg-slate-50" :
                                                        "bg-slate-50/40 hover:bg-slate-50/70"
                                                }`}>
                                            <td className="px-5 py-3 font-semibold text-slate-800">{pos.name}</td>
                                            <td className="px-5 py-3 whitespace-nowrap">
                                                <p className={`font-bold tabular-nums text-lg ${isNeg ? "text-red-700" : "text-slate-900"}`}>
                                                    {formatCurrency(pos.availableBalance)}
                                                </p>
                                                {pos.balance !== pos.availableBalance && (
                                                    <p className="text-xs text-slate-400 mt-0.5">actual: {formatCurrency(pos.balance)}</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">
                                                {pos.reservedAmount > 0 ? (
                                                    <div>
                                                        <p className="text-xs font-semibold text-amber-700">{formatCurrency(pos.reservedAmount)}</p>
                                                        <p className="text-xs text-slate-400 mt-0.5">reserved</p>
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-slate-300">—</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">
                                                <TreasuryHealthBadge balance={pos.availableBalance} targetFloat={pos.targetFloat} />
                                            </td>
                                            <td className="px-5 py-3 text-slate-600 tabular-nums">
                                                {pos.pendingCount > 0 ? (
                                                    <div>
                                                        <p className="text-xs font-bold text-amber-700">{pos.pendingCount} items</p>
                                                        <p className="text-xs text-slate-400 mt-0.5">{formatCurrency(pos.pendingAmount)}</p>
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-slate-300">—</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 tabular-nums">
                                                {refill ? (
                                                    <div>
                                                        <p className="text-xs font-bold text-amber-700">{formatCurrency(refill)}</p>
                                                        <p className="text-xs text-slate-400 mt-0.5">inject</p>
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-emerald-600 font-semibold">✓ Sufficient</p>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">
                                                {pos.oldestSubmittedAt !== null && Date.now() - pos.oldestSubmittedAt > 5 * 24 * 60 * 60 * 1000 ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                                                        <Clock className="w-3 h-3" /> Stalled
                                                    </span>
                                                ) : pos.availableBalance >= 0 && !refill ? (
                                                    <span className="text-xs text-emerald-600 font-semibold">Operational</span>
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
                SECTION 4: LIQUIDITY & EXPOSURE ANALYTICS
                Charts focused on treasury concentration and approval impact
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading
                title="Liquidity & Approval Exposure"
                icon={<BarChart3 className="w-4 h-4" />}
                subtitle="6-month trends, store performance, and category analysis"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Approved Spend Trend</p>
                        <p className="text-xs text-slate-400 mt-0.5">6-month approved expenses, cluster-wide</p>
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

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Top Stores by Spend</p>
                        <p className="text-xs text-slate-400 mt-0.5">Ranked by approved spend volume</p>
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
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION 5: APPROVAL BOTTLENECKS & TREASURY ACTIVITY
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading
                title="Approval Bottlenecks & Treasury Activity"
                icon={<Clock className="w-4 h-4" />}
                subtitle="Aging submissions and recent treasury top-ups"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">

                {/* Aging Approvals */}
                <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-orange-500 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-slate-700">Aging Submissions</p>
                                <p className="text-xs text-slate-400 mt-0.5">Pending 5+ days</p>
                            </div>
                        </div>
                        {agingApprovals.length > 0 && (
                            <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2.5 py-1 rounded-full flex-shrink-0">
                                {agingApprovals.length}
                            </span>
                        )}
                    </div>
                    {agingApprovals.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
                            <CheckCircle2 className="w-8 h-8 text-emerald-300" />
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
                                        const isSelected = e.id === selectedExpenseId;
                                        return (
                                            <tr key={e.id}
                                                onClick={() => setSelectedExpenseId(prev => prev === e.id ? null : e.id)}
                                                className={cn(
                                                    "border-b border-slate-50 cursor-pointer transition-colors",
                                                    isSelected
                                                        ? "bg-indigo-50 hover:bg-indigo-50/80"
                                                        : i % 2 === 0
                                                            ? "bg-white hover:bg-slate-50/70"
                                                            : "bg-slate-50/30 hover:bg-slate-50/70"
                                                )}>
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

                {/* Recent Treasury Credits */}
                <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                        <ArrowDownCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-slate-700">Recent Treasury Top-Ups</p>
                            <p className="text-xs text-slate-400 mt-0.5">Latest credit injections</p>
                        </div>
                    </div>
                    {filteredCredits.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
                            <Landmark className="w-8 h-8 text-slate-200" />
                            <p className="text-sm font-medium">No recent top-ups</p>
                            <p className="text-xs text-slate-300">No credit transactions recorded</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {filteredCredits.map((credit) => (
                                <div key={credit.id} className="flex items-center justify-between px-5 py-3 hover:bg-emerald-50/30 transition-colors">
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
                SECTION 6: CATEGORY & STORE ANALYTICS
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading
                title="Spend Breakdown"
                icon={<PieChart className="w-4 h-4" />}
                subtitle="Analysis by category and store performance"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Spend by Category</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved expenses, all stores</p>
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

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Store Comparison</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved · Pending · Rejected</p>
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
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION 7: REJECTION INSIGHTS (Preserved)
            ══════════════════════════════════════════════════════════════════ */}
            {rejected.length > 0 && (
                <>
                    <SectionHeading
                        title="Rejection Analysis"
                        icon={<AlertTriangle className="w-4 h-4" />}
                        subtitle="Patterns and problem areas"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">

                        <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                                <p className="text-sm font-semibold text-slate-700">By Category</p>
                                <p className="text-xs text-slate-400 mt-0.5">Problem categories</p>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Category", "Count", "Total"].map((h) => (
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
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                                <p className="text-sm font-semibold text-slate-700">Store Detail</p>
                                <p className="text-xs text-slate-400 mt-0.5">Highest rejection totals</p>
                            </div>
                            {rejectionByCategory.length === 0 ? (
                                <div className="flex items-center justify-center h-28 text-slate-300 text-sm">No data</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {["Category", "Count"].map((h) => (
                                                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rejectionByCategory.slice(0, 6).map((row, i) => (
                                            <tr key={row.name}
                                                className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                <td className="px-5 py-3 font-medium text-slate-700">{row.name}</td>
                                                <td className="px-5 py-3 font-semibold text-red-600 tabular-nums">{row.count} items</td>
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
                SECTION 8: ALL STORES DETAIL TABLE
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading
                title="Store Performance Detail"
                icon={<Store className="w-4 h-4" />}
                subtitle="Complete store-by-store breakdown"
            />
            <Card className="rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                    <p className="text-sm font-semibold text-slate-700">All Stores</p>
                    <p className="text-xs text-slate-400 mt-0.5">{storeBreakdown.length} stores in cluster</p>
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
                                    {["Store", "Approved", "Pending", "Rejected", "Total"].map((h) => (
                                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {storeBreakdown.map((s, i) => (
                                    <tr key={s.name}
                                        className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                        <td className="px-5 py-3 font-semibold text-slate-800">{s.name}</td>
                                        <td className="px-5 py-3 font-semibold text-emerald-700 tabular-nums">{formatCurrency(s.approved)}</td>
                                        <td className="px-5 py-3 font-semibold text-amber-600 tabular-nums">{formatCurrency(s.pending)}</td>
                                        <td className="px-5 py-3 font-semibold text-red-600 tabular-nums">{formatCurrency(s.rejected)}</td>
                                        <td className="px-5 py-3 text-slate-600 tabular-nums font-medium">{s.count} items</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

        </PageShell>

        {/* Expense detail drawer — click any row in Aging Submissions to inspect */}
        <ExpenseDrawer
            expenseId={selectedExpenseId}
            onClose={() => setSelectedExpenseId(null)}
        />
        </>
    );
}