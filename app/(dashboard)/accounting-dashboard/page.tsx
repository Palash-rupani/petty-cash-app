"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getClusterAvailableBalances } from "@/lib/finance/getClusterAvailableBalances";
import { getCashHealth } from "@/lib/finance/getCashHealth";
import { getRefillRecommendation } from "@/lib/finance/getRefillRecommendation";
import { getClusterName } from "@/lib/utils/getClusterName";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { DashboardFilterBar } from "@/components/dashboard/DashboardFilterBar";
import { useDashboardFilters, DateRangeFilter } from "@/lib/hooks/useDashboardFilters";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip,
    ResponsiveContainer, CartesianGrid, Legend, Cell,
    AreaChart, Area
} from "recharts";
import {
    Wallet, AlertTriangle, Activity,
    Landmark, ShieldAlert, RefreshCw, Zap,
    TrendingUp, Clock, Target, BarChart2
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreRow {
    id: string;
    name: string;
    monthly_limit: number;
    cluster_id: string;
    clusters: { id: string; name: string } | null;
}

interface Expense {
    id: string;
    amount: number;
    status: string;
    expense_month: string | null;
    created_at: string;
    store_id: string;
    categories: { name: string } | null;
}

interface ClusterTreasuryPosition {
    clusterId: string;
    name: string;
    balance: number;       // availableBalance sum for the cluster
    actualBalance: number; // actual ledger balance sum (credits − debits)
    targetFloat: number;
    refillNeed: number;
    criticalStores: number;
    storeCount: number;
    pendingExposure: number;
}

import { normalizeExpenseStatus } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const currencyFmt = (v: number | string) =>
    formatCurrency(typeof v === "number" ? v : Number(v));

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="p-6 max-w-screen-2xl mx-auto">{children}</div>;
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
    return (
        <div className="flex items-end gap-3 mb-4 mt-2">
            <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em]">{title}</h2>
                {sub && <p className="text-xs text-slate-400 mt-0.5 font-medium">{sub}</p>}
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
        </div>
    );
}

function KpiCard({
    icon, bg, label, value, sub, subColor = "text-slate-400",
}: {
    icon: React.ReactNode; bg: string; label: string; value: string;
    sub?: string; subColor?: string;
}) {
    return (
        <Card className="rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-xl ${bg} flex-shrink-0`}>{icon}</div>
                    <div>
                        <p className="text-xs font-medium text-slate-500 leading-tight">{label}</p>
                        <p className="text-xl font-bold text-slate-900 mt-0.5 leading-tight tabular-nums">{value}</p>
                        {sub && <p className={`text-xs mt-0.5 font-medium ${subColor}`}>{sub}</p>}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function InsightCard({ icon, text, severity }: {
    icon: React.ReactNode; text: string; severity: "info" | "warning" | "danger" | "success";
}) {
    const styles = {
        info: "bg-indigo-50 border-indigo-100 text-indigo-800",
        warning: "bg-amber-50 border-amber-100 text-amber-800",
        danger: "bg-red-50 border-red-100 text-red-800",
        success: "bg-emerald-50 border-emerald-100 text-emerald-800",
    };
    return (
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${styles[severity]} shadow-sm`}>
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <p className="text-sm font-medium leading-relaxed">{text}</p>
        </div>
    );
}

function EmptyChart() {
    return (
        <div className="flex items-center justify-center h-48 text-slate-300 text-sm font-medium">
            No data available for current filters
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="h-10 w-64 bg-slate-100 rounded-xl" />
            <div className="h-14 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
                {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-slate-100 rounded-2xl" />)}
            </div>
            <div className="h-72 bg-slate-100 rounded-2xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-64 bg-slate-100 rounded-2xl" />)}
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EnterpriseTreasuryDashboard() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [stores, setStores] = useState<StoreRow[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [balanceMap, setBalanceMap] = useState<Record<string, number> | null>(null);       // available
    const [actualBalanceMap, setActualBalanceMap] = useState<Record<string, number>>({});    // actual
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { filters, setFilter } = useDashboardFilters();

    // ── Fetch all stores, balances, and expenses ─────────────────────────────
    useEffect(() => {
        if (!user || user.role !== "accounting") return;
        setLoading(true);

        const fetchData = async () => {
            try {
                // 1. Fetch stores
                const { data: storeData, error: storeErr } = await supabase
                    .from("stores")
                    .select("id, name, monthly_limit, cluster_id, clusters(id, name)");

                if (storeErr) throw storeErr;
                const storeRows = (storeData ?? []) as unknown as StoreRow[];
                setStores(storeRows);

                const storeIds = storeRows.map((s) => s.id);
                if (storeIds.length === 0) {
                    setLoading(false);
                    return;
                }

                // 2. Fetch available balances (actual + reserved) and expenses
                const [balances, expResult] = await Promise.all([
                    getClusterAvailableBalances(storeIds),
                    supabase
                        .from("expenses")
                        .select("id, amount, status, expense_month, created_at, store_id, categories(name)")
                        .order("created_at", { ascending: false }),
                ]);

                if (expResult.error) throw expResult.error;

                const bMap: Record<string, number> = {};        // available
                const aBMap: Record<string, number> = {};       // actual
                balances.forEach((b) => {
                    bMap[b.storeId] = b.availableBalance;
                    aBMap[b.storeId] = b.actualBalance;
                });
                setBalanceMap(bMap);
                setActualBalanceMap(aBMap);

                const expRows = ((expResult.data ?? []) as any[]).map((row) => ({
                    ...row,
                    categories: row.categories ? (Array.isArray(row.categories) ? row.categories[0] : row.categories) : null,
                })) as Expense[];
                setExpenses(expRows);

            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user]);

    // ══════════════════════════════════════════════════════════════════════════
    // GLOBAL ENTERPRISE STATE (Ignores selectedStores & dateRange)
    // ══════════════════════════════════════════════════════════════════════════

    const globalPositions = useMemo(() => {
        if (!balanceMap) return [];
        const map: Record<string, ClusterTreasuryPosition> = {};

        // Seed from all stores
        stores.forEach((s) => {
            const cid = s.cluster_id;
            if (!cid) return; // Skip stores without clusters

            if (!map[cid]) {
                map[cid] = {
                    clusterId: cid,
                    name: getClusterName(s.clusters),
                    balance: 0,
                    actualBalance: 0,
                    targetFloat: 0,
                    refillNeed: 0,
                    criticalStores: 0,
                    storeCount: 0,
                    pendingExposure: 0,
                };
            }

            const pos = map[cid];
            const bal = balanceMap[s.id] ?? 0;          // available balance
            const actual = actualBalanceMap[s.id] ?? 0;
            const target = s.monthly_limit ?? 0;
            const health = getCashHealth(bal, target);   // health = f(availableBalance)

            pos.storeCount++;
            pos.balance += bal;
            pos.actualBalance += actual;
            pos.targetFloat += target;
            pos.refillNeed += getRefillRecommendation(bal, target);
            if (health === "low" || health === "negative") pos.criticalStores++;
        });

        // Add pending exposure from all expenses
        expenses.forEach((e) => {
            if (normalizeExpenseStatus(e.status as any) === 'submitted') {
                const store = stores.find((s) => s.id === e.store_id);
                if (store && store.cluster_id && map[store.cluster_id]) {
                    map[store.cluster_id].pendingExposure += e.amount;
                }
            }
        });

        return Object.values(map).sort((a, b) => a.balance - b.balance);
    }, [stores, expenses, balanceMap, actualBalanceMap]);

    // Enterprise KPIs
    const totalTreasuryBalance = useMemo(() => globalPositions.reduce((s, p) => s + p.balance, 0), [globalPositions]);
    const totalRefillRequirement = useMemo(() => globalPositions.reduce((s, p) => s + p.refillNeed, 0), [globalPositions]);
    const totalCriticalStores = useMemo(() => globalPositions.reduce((s, p) => s + p.criticalStores, 0), [globalPositions]);
    const enterprisePendingExposure = useMemo(() => globalPositions.reduce((s, p) => s + p.pendingExposure, 0), [globalPositions]);
    const largestExposureCluster = useMemo(() => [...globalPositions].sort((a, b) => b.pendingExposure - a.pendingExposure)[0], [globalPositions]);

    // ══════════════════════════════════════════════════════════════════════════
    // TIME-SCOPED ANALYTICS (Respects filters)
    // ══════════════════════════════════════════════════════════════════════════

    const activeStoreIds = useMemo(() => {
        return stores.filter((s) => {
            if (filters.selectedStores.length > 0 && !filters.selectedStores.includes(s.id)) return false;
            // Optionally apply treasuryHealth filter to analytics if desired, though usually it's for current state.
            // Assuming it applies to narrow down the analytical view as well.
            if (filters.treasuryHealth.length > 0) {
                const bal = balanceMap ? balanceMap[s.id] ?? 0 : 0;
                const health = getCashHealth(bal, s.monthly_limit);
                if (!filters.treasuryHealth.includes(health)) return false;
            }
            return true;
        }).map((s) => s.id);
    }, [stores, filters.selectedStores, filters.treasuryHealth, balanceMap]);

    const filteredExpenses = useMemo(() => {
        return expenses.filter((e) => {
            if (!activeStoreIds.includes(e.store_id)) return false;
            return isDateInRange(e.created_at, filters.dateRange);
        });
    }, [expenses, activeStoreIds, filters.dateRange]);

    const filteredApproved = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "approved"), [filteredExpenses]);
    const filteredPending = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "submitted"), [filteredExpenses]);
    const filteredRejected = useMemo(() => filteredExpenses.filter((e) => normalizeExpenseStatus(e.status as any) === "rejected"), [filteredExpenses]);

    // Analytics: Burn Trend
    const burnTrendData = useMemo(() => {
        const map: Record<string, number> = {};
        filteredApproved.forEach((e) => {
            const key = e.expense_month ? e.expense_month.slice(0, 7) : monthKey(e.created_at);
            map[key] = (map[key] ?? 0) + e.amount;
        });

        const months: { month: string; amount: number }[] = [];
        // Show last 6 months strictly
        for (let i = 5; i >= 0; i--) {
            const d = new Date(); d.setMonth(d.getMonth() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            months.push({ month: monthLabel(key), amount: map[key] ?? 0 });
        }
        return months;
    }, [filteredApproved]);

    // Analytics: Approved Spend by Cluster
    const clusterSpendData = useMemo(() => {
        const map: Record<string, number> = {};
        filteredApproved.forEach((e) => {
            const store = stores.find((s) => s.id === e.store_id);
            const cName = getClusterName(store?.clusters);
            map[cName] = (map[cName] ?? 0) + e.amount;
        });
        return Object.entries(map)
            .map(([name, value]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);
    }, [filteredApproved, stores]);

    // Analytics: Category Allocation
    const categorySpendData = useMemo(() => {
        const map: Record<string, number> = {};
        filteredApproved.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            map[k] = (map[k] ?? 0) + e.amount;
        });
        return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    }, [filteredApproved]);

    // ══════════════════════════════════════════════════════════════════════════
    // EXECUTIVE INSIGHTS (Global context)
    // ══════════════════════════════════════════════════════════════════════════

    const insights = useMemo(() => {
        const out: { text: string; severity: "info" | "warning" | "danger" | "success"; icon: React.ReactNode }[] = [];

        // Highest refill cluster
        const topRefill = [...globalPositions].sort((a, b) => b.refillNeed - a.refillNeed)[0];
        if (topRefill && topRefill.refillNeed > 0 && totalRefillRequirement > 0) {
            const pct = Math.round((topRefill.refillNeed / totalRefillRequirement) * 100);
            if (pct >= 30) {
                out.push({
                    text: `Refill Concentration: ${topRefill.name} accounts for ${pct}% of the total enterprise refill requirement (${formatCurrency(topRefill.refillNeed)}).`,
                    severity: "warning", icon: <AlertTriangle className="w-4 h-4" />
                });
            }
        }

        // Critical Stores cluster
        const highRisk = globalPositions.filter((p) => p.criticalStores >= 2);
        if (highRisk.length > 0) {
            out.push({
                text: `High Risk Clusters: ${highRisk.length} cluster(s) have multiple stores with critical cash levels. Urgent capital allocation required.`,
                severity: "danger", icon: <ShieldAlert className="w-4 h-4" />
            });
        } else if (totalCriticalStores === 0) {
            out.push({
                text: `Enterprise Liquidity: All ${stores.length} stores are operating with healthy cash floats.`,
                severity: "success", icon: <Activity className="w-4 h-4" />
            });
        }

        // Abnormal Exposure
        if (largestExposureCluster && largestExposureCluster.pendingExposure > 50000) {
            out.push({
                text: `Abnormal Exposure: ${largestExposureCluster.name} has a significant pending pipeline of ${formatCurrency(largestExposureCluster.pendingExposure)}. Expedite approvals to prevent cash flow stall.`,
                severity: "warning", icon: <Zap className="w-4 h-4" />
            });
        }

        // General pipeline
        if (totalTreasuryBalance < 0) {
            out.push({
                text: `Severe Treasury Imbalance: Enterprise available balance is in deficit by ${formatCurrency(Math.abs(totalTreasuryBalance))}. Review immediate liabilities and reservations.`,
                severity: "danger", icon: <Landmark className="w-4 h-4" />
            });
        } else if (totalRefillRequirement === 0) {
            out.push({
                text: `Optimal Allocation: The enterprise treasury is perfectly balanced with no immediate refill requirements detected.`,
                severity: "info", icon: <Target className="w-4 h-4" />
            });
        }

        return out.slice(0, 4);
    }, [globalPositions, totalRefillRequirement, totalCriticalStores, largestExposureCluster, totalTreasuryBalance, stores.length]);


    // ── Guards ───────────────────────────────────────────────────────────────
    if (authLoading) return <PageShell><LoadingState /></PageShell>;

    if (!user || user.role !== "accounting") {
        return (
            <PageShell>
                <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-slate-400">
                    <ShieldAlert className="w-16 h-16 text-slate-200" />
                    <h2 className="text-xl font-bold text-slate-600">Executive Access Required</h2>
                    <p className="text-sm font-medium text-slate-500">This intelligence platform is restricted to the Accounting team.</p>
                </div>
            </PageShell>
        );
    }

    if (error) return <PageShell><p className="text-red-500 font-semibold p-6">{error}</p></PageShell>;

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <PageShell>

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
                <div>
                    <p className="text-xs font-bold text-indigo-600 uppercase tracking-[0.2em] mb-1">Corporate Command</p>
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Enterprise Treasury Intelligence</h1>
                    <p className="text-sm text-slate-500 mt-1.5 font-medium max-w-2xl">
                        Strategic overview of organisation-wide cash liquidity, cluster risk profiles, and historical burn analytics.
                    </p>
                </div>
            </div>

            <DashboardFilterBar filters={filters} setFilter={setFilter} stores={stores.map(s => ({ id: s.id, name: s.name }))} />

            {/* ══════════════════════════════════════════════════════════════════════
                ENTERPRISE TREASURY KPIs (GLOBAL STATE)
            ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Global Executive State" sub="Real-time un-filtered enterprise totals" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 mb-10">
                <KpiCard
                    icon={<Landmark className="w-5 h-5 text-indigo-600" />} bg="bg-indigo-50"
                    label="Total Available Balance"
                    value={formatCurrency(totalTreasuryBalance)}
                    sub={`${stores.length} active stores`}
                />
                <KpiCard
                    icon={<RefreshCw className="w-5 h-5 text-amber-600" />} bg="bg-amber-50"
                    label="Total Refill Requirement"
                    value={formatCurrency(totalRefillRequirement)}
                    sub="Enterprise-wide capital need"
                    subColor={totalRefillRequirement > 0 ? "text-amber-600" : "text-emerald-600"}
                />
                <KpiCard
                    icon={<ShieldAlert className="w-5 h-5 text-red-500" />} bg="bg-red-50"
                    label="Critical Stores"
                    value={String(totalCriticalStores)}
                    sub="Negative or low liquidity"
                    subColor={totalCriticalStores > 0 ? "text-red-600" : "text-emerald-600"}
                />
                <KpiCard
                    icon={<Activity className="w-5 h-5 text-blue-600" />} bg="bg-blue-50"
                    label="Pending Exposure"
                    value={formatCurrency(enterprisePendingExposure)}
                    sub="Total unapproved pipeline"
                />
                <KpiCard
                    icon={<Zap className="w-5 h-5 text-orange-600" />} bg="bg-orange-50"
                    label="Max Cluster Exposure"
                    value={largestExposureCluster ? formatCurrency(largestExposureCluster.pendingExposure) : "—"}
                    sub={largestExposureCluster?.name ?? "No exposure"}
                />
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
                ENTERPRISE RISK INSIGHTS
            ══════════════════════════════════════════════════════════════════════ */}
            {insights.length > 0 && (
                <div className="mb-10">
                    <SectionHeading title="Strategic Insights" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {insights.map((ins, i) => (
                            <InsightCard key={i} icon={ins.icon} text={ins.text} severity={ins.severity} />
                        ))}
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
                CLUSTER TREASURY MATRIX (GLOBAL)
            ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Cluster Treasury Matrix" sub="Enterprise-wide operational risk ranking" />
            <Card className="rounded-2xl border border-slate-200 shadow-sm mb-10 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
                    <p className="text-sm font-semibold text-slate-700">Cluster Risk Profiles</p>
                </div>
                {loading && !balanceMap ? (
                    <div className="h-32 flex items-center justify-center text-slate-400 text-sm font-medium">Loading ledger data…</div>
                ) : globalPositions.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-slate-400 text-sm font-medium">No clusters found</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-white border-b border-slate-200">
                                    {["Cluster", "Available Balance", "Risk Level", "Refill Need", "Pending Exposure", "Critical Stores"].map((h) => (
                                        <th key={h} className="text-left px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {globalPositions.map((pos) => {
                                    const riskPct = pos.targetFloat > 0 ? pos.refillNeed / pos.targetFloat : 0;
                                    const riskLvl = riskPct > 0.4 || pos.criticalStores > 1 ? "High" : riskPct > 0.1 || pos.criticalStores > 0 ? "Medium" : "Low";
                                    const riskColor = riskLvl === "High" ? "text-red-700 bg-red-50 border-red-200" : riskLvl === "Medium" ? "text-amber-700 bg-amber-50 border-amber-200" : "text-emerald-700 bg-emerald-50 border-emerald-200";

                                    return (
                                        <tr key={pos.clusterId} className="hover:bg-slate-50/80 transition-colors bg-white">
                                            <td className="px-5 py-4 font-bold text-slate-800">{pos.name}</td>
                                            <td className="px-5 py-4">
                                                <p className={`font-bold tabular-nums ${pos.balance < 0 ? "text-red-600" : "text-slate-900"}`}>
                                                    {formatCurrency(pos.balance)}
                                                </p>
                                                <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                                                    Actual: {formatCurrency(pos.actualBalance)}
                                                </p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${riskColor}`}>
                                                    {riskLvl} Risk
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 font-semibold text-amber-700 tabular-nums">
                                                {pos.refillNeed > 0 ? formatCurrency(pos.refillNeed) : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-5 py-4 text-slate-600 font-medium tabular-nums">
                                                {formatCurrency(pos.pendingExposure)}
                                            </td>
                                            <td className="px-5 py-4">
                                                {pos.criticalStores > 0 ? (
                                                    <span className="font-bold text-red-600">{pos.criticalStores}</span>
                                                ) : (
                                                    <span className="text-emerald-600 font-medium text-xs">Healthy</span>
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

            {/* ══════════════════════════════════════════════════════════════════════
                TIME-SCOPED ANALYTICS
            ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Time-Scoped Analytics" sub="Filtered by selected date range and stores" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <KpiCard icon={<BarChart2 className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50" label="Filtered Approved Spend" value={formatCurrency(filteredApproved.reduce((s, e) => s + e.amount, 0))} />
                <KpiCard icon={<Clock className="w-4 h-4 text-amber-500" />} bg="bg-amber-50" label="Filtered Pending Pipeline" value={formatCurrency(filteredPending.reduce((s, e) => s + e.amount, 0))} />
                <KpiCard icon={<TrendingUp className="w-4 h-4 text-indigo-600" />} bg="bg-indigo-50" label="Filtered Expense Count" value={String(filteredExpenses.length)} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-10">
                {/* Burn Trend */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100 pb-4 bg-slate-50/30">
                        <p className="text-sm font-bold text-slate-800">Enterprise Burn Trend</p>
                        <p className="text-xs text-slate-500 mt-0.5">Approved expenses over time (filtered scope)</p>
                    </CardHeader>
                    <CardContent className="pt-6">
                        {burnTrendData.every((d) => d.amount === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={260}>
                                <AreaChart data={burnTrendData} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                                    <defs>
                                        <linearGradient id="colorBurn" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }} tickLine={false} axisLine={false} dy={8} />
                                    <YAxis tick={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={44} />
                                    <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                                    <Area type="monotone" dataKey="amount" name="Approved Spend" stroke="#4f46e5" strokeWidth={3} fill="url(#colorBurn)" activeDot={{ r: 6, strokeWidth: 0 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Treasury Allocation / Concentration */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100 pb-4 bg-slate-50/30">
                        <p className="text-sm font-bold text-slate-800">Treasury Consumption by Cluster</p>
                        <p className="text-xs text-slate-500 mt-0.5">Approved spend distribution (horizontal bars for scalability)</p>
                    </CardHeader>
                    <CardContent className="pt-6">
                        {clusterSpendData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={clusterSpendData} layout="vertical" barSize={14} margin={{ left: 16, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569", fontWeight: 600 }} width={110} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} cursor={{ fill: "#f8fafc" }} />
                                    <Bar dataKey="value" name="Approved Amount" radius={[0, 4, 4, 0]}>
                                        {clusterSpendData.map((_, i) => (
                                            <Cell key={i} fill={`hsl(225, ${80 - i * 4}%, ${60 + i * 2}%)`} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Category Analytics */}
            <Card className="rounded-2xl border border-slate-200 shadow-sm mb-8">
                <CardHeader className="border-b border-slate-100 pb-4 bg-slate-50/30">
                    <p className="text-sm font-bold text-slate-800">Enterprise Spend Categories</p>
                    <p className="text-xs text-slate-500 mt-0.5">Where is capital being allocated?</p>
                </CardHeader>
                <CardContent className="pt-6">
                    {categorySpendData.length === 0 ? <EmptyChart /> : (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={categorySpendData} layout="vertical" barSize={16} margin={{ left: 16, right: 16, top: 4, bottom: 4 }}>
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569", fontWeight: 600 }} width={140} tickLine={false} axisLine={false} />
                                <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} cursor={{ fill: "#f8fafc" }} />
                                <Bar dataKey="value" name="Approved Amount" radius={[0, 4, 4, 0]}>
                                    {categorySpendData.map((_, i) => (
                                        <Cell key={i} fill={`hsl(160, ${75 - i * 4}%, ${45 + i * 3}%)`} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

        </PageShell>
    );
}