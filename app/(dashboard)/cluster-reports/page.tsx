"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    CartesianGrid,
    Legend,
    Cell,
} from "recharts";
import {
    TrendingUp,
    Wallet,
    Receipt,
    ArrowUpCircle,
    ExternalLink,
    Clock,
    XCircle,
    AlertTriangle,
    CheckCircle2,
    Store,
    ChevronRight,
    ShieldAlert,
    Activity,
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

// ─── Status Groups ────────────────────────────────────────────────────────────

const APPROVED_STATUSES = ["accounting_approved", "synced_to_tally"];
const PENDING_STATUSES = ["draft", "submitted", "cluster_approved"];
const REJECTED_STATUSES = ["cluster_rejected", "accounting_rejected", "tally_sync_failed"];
const SUBMITTED_STATUSES = ["submitted"];               // needs cluster action
const ACCT_PENDING = ["cluster_approved"];        // passed cluster, at accounting

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToLabel(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
    });
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

// ─── Chart tooltip formatter (avoids Recharts generic type errors) ────────────

const currencyFmt = (v: number | string) =>
    formatCurrency(typeof v === "number" ? v : Number(v));

// ─── Reusable sub-components ──────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="p-6 max-w-7xl mx-auto">{children}</div>;
}

function SectionHeading({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-2 mb-3 mt-2">
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
        <Card className="rounded-xl border border-slate-200 shadow-sm">
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
        <div className="space-y-4 animate-pulse">
            <div className="h-8 w-56 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
                {[...Array(6)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-56 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="h-64 bg-slate-100 rounded-xl" />
            <div className="h-48 bg-slate-100 rounded-xl" />
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClusterReportsPage() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [trendData, setTrendData] = useState<{ month: string; amount: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ── Fetch all expenses for this cluster ──────────────────────────────────
    useEffect(() => {
        if (!user?.cluster_id) return;

        setLoading(true);

        // First get all store IDs in this cluster
        supabase
            .from("stores")
            .select("id")
            .eq("cluster_id", user.cluster_id)
            .then(({ data: storeRows, error: storeErr }) => {
                if (storeErr) { setError(storeErr.message); setLoading(false); return; }
                const storeIds = (storeRows ?? []).map((s) => s.id as string);
                if (storeIds.length === 0) { setExpenses([]); setLoading(false); return; }

                supabase
                    .from("expenses")
                    .select(
                        "id, amount, status, expense_month, created_at, receipt_url, store_id, " +
                        "stores(name, monthly_limit), categories(name)"
                    )
                    .in("store_id", storeIds)
                    .order("created_at", { ascending: false })
                    .then(({ data, error: expErr }) => {
                        setLoading(false);
                        if (expErr) { setError(expErr.message); return; }
                        const normalised = ((data ?? []) as any[]).map((row) => ({
                            ...row,
                            stores: normaliseJoin(row.stores),
                            categories: normaliseJoin(row.categories),
                        })) as Expense[];
                        setExpenses(normalised);
                    });
            });
    }, [user?.cluster_id]);

    // ── Fetch 6-month approved trend for this cluster ────────────────────────
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
                    .select("amount, expense_month, created_at, status")
                    .in("store_id", storeIds)
                    .in("status", APPROVED_STATUSES)
                    .gte("created_at", sixAgo.toISOString())
                    .then(({ data }) => {
                        if (!data) return;
                        const map: Record<string, number> = {};
                        data.forEach((e) => {
                            const key = e.expense_month
                                ? (e.expense_month as string).slice(0, 7)
                                : monthKey((e.created_at as string) ?? "");
                            map[key] = (map[key] ?? 0) + (e.amount as number);
                        });
                        const months = [];
                        for (let i = 5; i >= 0; i--) {
                            const d = new Date(); d.setMonth(d.getMonth() - i);
                            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                            months.push({ month: monthLabel(key), amount: map[key] ?? 0 });
                        }
                        setTrendData(months);
                    });
            });
    }, [user?.cluster_id]);

    // ────────────────────────────────────────────────────────────────────────────
    // Derived data — all memoised
    // ────────────────────────────────────────────────────────────────────────────

    const approved = useMemo(() => expenses.filter((e) => APPROVED_STATUSES.includes(e.status)), [expenses]);
    const pending = useMemo(() => expenses.filter((e) => PENDING_STATUSES.includes(e.status)), [expenses]);
    const rejected = useMemo(() => expenses.filter((e) => REJECTED_STATUSES.includes(e.status)), [expenses]);
    const submitted = useMemo(() => expenses.filter((e) => SUBMITTED_STATUSES.includes(e.status)), [expenses]);
    const acctPend = useMemo(() => expenses.filter((e) => ACCT_PENDING.includes(e.status)), [expenses]);
    const clRejected = useMemo(() => expenses.filter((e) => e.status === "cluster_rejected"), [expenses]);

    const totalApproved = useMemo(() => sumAmount(approved), [approved]);
    const totalPending = useMemo(() => sumAmount(pending), [pending]);
    const totalRejected = useMemo(() => sumAmount(rejected), [rejected]);
    const largestExpense = useMemo(
        () => (expenses.length ? Math.max(...expenses.map((e) => e.amount)) : 0),
        [expenses]
    );

    // Unique store count
    const storeCount = useMemo(() => {
        const ids = new Set(expenses.map((e) => e.store_id));
        return ids.size;
    }, [expenses]);

    // Per-store breakdown
    const storeBreakdown = useMemo(() => {
        const map: Record<string, {
            name: string; monthly_limit: number;
            approved: number; pending: number; rejected: number; count: number;
        }> = {};
        expenses.forEach((e) => {
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
            if (PENDING_STATUSES.includes(e.status)) map[sid].pending += e.amount;
            if (REJECTED_STATUSES.includes(e.status)) map[sid].rejected += e.amount;
        });
        return Object.values(map).sort((a, b) => b.approved - a.approved);
    }, [expenses]);

    // Top stores by approved spend (bar chart)
    const topStoresChart = useMemo(
        () => storeBreakdown.slice(0, 8).map((s) => ({ name: s.name, value: s.approved })),
        [storeBreakdown]
    );

    // Category breakdown (approved only)
    const categoryData = useMemo(() => {
        const map: Record<string, number> = {};
        approved.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            map[k] = (map[k] ?? 0) + e.amount;
        });
        return Object.entries(map)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);
    }, [approved]);

    // Rejection by category
    const rejectionByCategory = useMemo(() => {
        const map: Record<string, { count: number; total: number }> = {};
        rejected.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            if (!map[k]) map[k] = { count: 0, total: 0 };
            map[k].count++; map[k].total += e.amount;
        });
        return Object.entries(map)
            .map(([name, v]) => ({ name, ...v }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
    }, [rejected]);

    // Rejection by store
    const rejectionByStore = useMemo(() => {
        return storeBreakdown
            .filter((s) => s.rejected > 0)
            .map((s) => ({ name: s.name, rejected: s.rejected, count: 0 }))
            .sort((a, b) => b.rejected - a.rejected)
            .slice(0, 6);
    }, [storeBreakdown]);

    // Budget risk: stores where approved + pending > monthly_limit
    const budgetRiskStores = useMemo(
        () => storeBreakdown.filter(
            (s) => s.monthly_limit > 0 && (s.approved + s.pending) > s.monthly_limit
        ),
        [storeBreakdown]
    );

    // High-pending stores: pending > 50% of limit
    const highPendingStores = useMemo(
        () => storeBreakdown.filter(
            (s) => s.monthly_limit > 0 && s.pending / s.monthly_limit > 0.5
        ),
        [storeBreakdown]
    );

    // High-rejection stores: rejection rate > 30% of all expense count
    const highRejectionStores = useMemo(() => {
        const rejCountMap: Record<string, number> = {};
        const totalCountMap: Record<string, number> = {};
        expenses.forEach((e) => {
            totalCountMap[e.store_id] = (totalCountMap[e.store_id] ?? 0) + 1;
            if (REJECTED_STATUSES.includes(e.status))
                rejCountMap[e.store_id] = (rejCountMap[e.store_id] ?? 0) + 1;
        });
        return storeBreakdown.filter((s) => {
            const sid = expenses.find((e) => e.stores?.name === s.name)?.store_id ?? "";
            const rej = rejCountMap[sid] ?? 0;
            const tot = totalCountMap[sid] ?? 0;
            return tot >= 3 && rej / tot > 0.3;
        });
    }, [storeBreakdown, expenses]);

    const hasRisks = budgetRiskStores.length > 0 || highPendingStores.length > 0 || highRejectionStores.length > 0;

    // Store comparison chart (multi-bar)
    const storeComparisonChart = useMemo(
        () => storeBreakdown.slice(0, 7).map((s) => ({
            name: s.name.length > 12 ? s.name.slice(0, 12) + "…" : s.name,
            Approved: s.approved,
            Pending: s.pending,
            Rejected: s.rejected,
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

    if (error) return <PageShell><p className="text-red-500 p-6">{error}</p></PageShell>;

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <PageShell>

            {/* ── Header ── */}
            <div className="flex flex-col gap-1 mb-6">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cluster Report</h1>
                <p className="text-sm text-slate-500 font-medium">
                    Analytics across all stores in your cluster
                </p>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION A — KPI Cards
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Overview" />
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
                <StatCard
                    icon={<Wallet className="w-5 h-5 text-indigo-600" />} bg="bg-indigo-50"
                    label="Total Approved" value={formatCurrency(totalApproved)} />
                <StatCard
                    icon={<Clock className="w-5 h-5 text-amber-500" />} bg="bg-amber-50"
                    label="Pending Amount" value={formatCurrency(totalPending)}
                    sub={`${pending.length} expenses`} subColor="text-amber-600" />
                <StatCard
                    icon={<XCircle className="w-5 h-5 text-red-500" />} bg="bg-red-50"
                    label="Rejected Amount" value={formatCurrency(totalRejected)}
                    sub={rejected.length > 0 ? `${rejected.length} expenses` : "None"} subColor="text-red-500" />
                <StatCard
                    icon={<Receipt className="w-5 h-5 text-violet-600" />} bg="bg-violet-50"
                    label="Total Expenses" value={String(expenses.length)} />
                <StatCard
                    icon={<ArrowUpCircle className="w-5 h-5 text-emerald-600" />} bg="bg-emerald-50"
                    label="Largest Expense" value={formatCurrency(largestExpense)} />
                <StatCard
                    icon={<Store className="w-5 h-5 text-cyan-600" />} bg="bg-cyan-50"
                    label="Stores in Cluster" value={String(storeCount)} />
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION B — Approval Analytics
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Analytics" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <StatCard
                    icon={<Activity className="w-5 h-5 text-blue-500" />} bg="bg-blue-50"
                    label="Submitted (Awaiting You)" value={String(submitted.length)}
                    sub={formatCurrency(sumAmount(submitted))} subColor="text-blue-600" />
                <StatCard
                    icon={<CheckCircle2 className="w-5 h-5 text-teal-500" />} bg="bg-teal-50"
                    label="Cluster Approved" value={String(acctPend.length)}
                    sub="At accounting" subColor="text-teal-600" />
                <StatCard
                    icon={<XCircle className="w-5 h-5 text-orange-500" />} bg="bg-orange-50"
                    label="Cluster Rejected" value={String(clRejected.length)}
                    sub={formatCurrency(sumAmount(clRejected))} subColor="text-orange-600" />
                <StatCard
                    icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} bg="bg-emerald-50"
                    label="Fully Approved" value={String(approved.length)}
                    sub={formatCurrency(totalApproved)} subColor="text-emerald-600" />
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION C — Charts: Top Stores + Monthly Trend
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Spend Analytics" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

                {/* Top Spending Stores */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Top Stores by Approved Spend</p>
                        <p className="text-xs text-slate-400">Ranked by accounting-approved amount</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {topStoresChart.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={topStoresChart} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name"
                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                    />
                                    <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Monthly Trend */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Monthly Trend</p>
                        <p className="text-xs text-slate-400">Cluster-wide approved spend, last 6 months</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {trendData.every((d) => d.amount === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <LineChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                                        width={36}
                                    />
                                    <Tooltip
                                        formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                    />
                                    <Line type="monotone" dataKey="amount" stroke="#6366f1" strokeWidth={2.5}
                                        dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION D — Store Comparison + Category Spend
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Store &amp; Category Breakdown" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

                {/* Store Comparison multi-bar */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Store Comparison</p>
                        <p className="text-xs text-slate-400">Approved · Pending · Rejected per store</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {storeComparisonChart.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={storeComparisonChart} barSize={7}
                                    margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={36} />
                                    <Tooltip
                                        formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                    />
                                    <Legend iconType="circle" iconSize={7}
                                        formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
                                    <Bar dataKey="Approved" fill="#22c55e" radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="Rejected" fill="#ef4444" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Category spend */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Spend by Category</p>
                        <p className="text-xs text-slate-400">Approved expenses across all cluster stores</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {categoryData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={categoryData} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name"
                                        tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        formatter={currencyFmt as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                        {categoryData.map((_, i) => (
                                            <Cell key={i} fill={`hsl(${240 + i * 22}, 65%, ${58 - i * 3}%)`} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION E — Store Comparison Table
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Store Detail" />
            <Card className="rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
                <CardHeader className="border-b border-slate-100 pb-3">
                    <p className="text-sm font-semibold text-slate-700">All Stores</p>
                    <p className="text-xs text-slate-400 mt-0.5">{storeBreakdown.length} store{storeBreakdown.length !== 1 ? "s" : ""} in cluster</p>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-28 text-slate-400 text-sm">Loading…</div>
                    ) : storeBreakdown.length === 0 ? (
                        <div className="flex items-center justify-center h-28 text-slate-400 text-sm">No store data.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Store", "Approved", "Pending", "Rejected", "Expenses", "Budget Used"].map((h) => (
                                            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {storeBreakdown.map((s, i) => {
                                        const budgetPct = s.monthly_limit > 0
                                            ? Math.min(((s.approved + s.pending) / s.monthly_limit) * 100, 999)
                                            : 0;
                                        const over = s.monthly_limit > 0 && budgetPct > 100;
                                        return (
                                            <tr key={s.name}
                                                className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                                                <td className="px-4 py-3 font-semibold text-emerald-700 tabular-nums">{formatCurrency(s.approved)}</td>
                                                <td className="px-4 py-3 font-semibold text-amber-600 tabular-nums">{formatCurrency(s.pending)}</td>
                                                <td className="px-4 py-3 font-semibold text-red-600 tabular-nums">{formatCurrency(s.rejected)}</td>
                                                <td className="px-4 py-3 text-slate-600 tabular-nums">{s.count}</td>
                                                <td className="px-4 py-3">
                                                    {s.monthly_limit > 0 ? (
                                                        <span className={`text-xs font-semibold ${over ? "text-red-600" : "text-slate-600"}`}>
                                                            {budgetPct.toFixed(0)}%{over ? " ⚠" : ""}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 text-xs">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION F — Pending Approval Queue
      ══════════════════════════════════════════════════════════════════════ */}
            {submitted.length > 0 && (
                <>
                    <SectionHeading title="Pending Approval Queue" />
                    <Card className="rounded-xl border border-amber-200 shadow-sm mb-6 overflow-hidden"
                        style={{ backgroundColor: "rgba(254,243,199,0.15)" }}>
                        <CardHeader className="border-b border-amber-100 pb-3">
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-amber-500" />
                                <p className="text-sm font-semibold text-slate-700">Submitted — Awaiting Your Approval</p>
                                <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                    {submitted.length} expense{submitted.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                {formatCurrency(sumAmount(submitted))} total held · Requires your action
                            </p>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-amber-50 border-b border-amber-100">
                                            {["Date", "Store", "Category", "Amount", "Status", "Receipt"].map((h) => (
                                                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {submitted.map((e, i) => (
                                            <tr key={e.id}
                                                className={`border-b border-amber-50 hover:bg-amber-50/60 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-amber-50/20"}`}>
                                                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                                <td className="px-4 py-3 text-slate-700 font-medium">{e.stores?.name ?? "—"}</td>
                                                <td className="px-4 py-3 text-slate-600">{e.categories?.name ?? "—"}</td>
                                                <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">{formatCurrency(e.amount)}</td>
                                                <td className="px-4 py-3">
                                                    <Badge status={e.status as any} />
                                                </td>
                                                <td className="px-4 py-3">
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
                        </CardContent>
                    </Card>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION G — Rejection Insights
      ══════════════════════════════════════════════════════════════════════ */}
            {rejected.length > 0 && (
                <>
                    <SectionHeading title="Rejection Insights" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

                        {/* By category */}
                        <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <CardHeader className="border-b border-slate-100 pb-3">
                                <p className="text-sm font-semibold text-slate-700">Rejections by Category</p>
                                <p className="text-xs text-slate-400">All rejection stages</p>
                            </CardHeader>
                            <CardContent className="p-0">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {["Category", "Count", "Amount"].map((h) => (
                                                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rejectionByCategory.map((row, i) => (
                                            <tr key={row.name}
                                                className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                <td className="px-4 py-3 font-medium text-slate-700">{row.name}</td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold">
                                                        {row.count}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                                                    {formatCurrency(row.total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </CardContent>
                        </Card>

                        {/* By store */}
                        <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <CardHeader className="border-b border-slate-100 pb-3">
                                <p className="text-sm font-semibold text-slate-700">Rejections by Store</p>
                                <p className="text-xs text-slate-400">Stores with highest rejection totals</p>
                            </CardHeader>
                            <CardContent className="p-0">
                                {rejectionByStore.length === 0 ? (
                                    <div className="flex items-center justify-center h-28 text-slate-300 text-sm">No data</div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                {["Store", "Rejected Amount"].map((h) => (
                                                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rejectionByStore.map((row, i) => (
                                                <tr key={row.name}
                                                    className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                    <td className="px-4 py-3 font-medium text-slate-700">{row.name}</td>
                                                    <td className="px-4 py-3 font-semibold text-red-600 tabular-nums">
                                                        {formatCurrency(row.rejected)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION H — Approval Pipeline
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Pipeline" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-1">
                        <p className="text-sm font-semibold text-slate-700">Expense Pipeline</p>
                        <p className="text-xs text-slate-400">Cluster-wide breakdown by stage</p>
                    </CardHeader>
                    <CardContent>
                        <PipelineStep label="Awaiting Your Approval" count={submitted.length}
                            amount={sumAmount(submitted)} color="#f59e0b" icon={<Clock className="w-4 h-4" />} />
                        <PipelineStep label="Cluster Approved → Accounting" count={acctPend.length}
                            amount={sumAmount(acctPend)} color="#14b8a6" icon={<CheckCircle2 className="w-4 h-4" />} />
                        <PipelineStep label="Fully Approved" count={approved.length}
                            amount={totalApproved} color="#22c55e" icon={<TrendingUp className="w-4 h-4" />} />
                        <PipelineStep label="Rejected" count={rejected.length}
                            amount={totalRejected} color="#ef4444" icon={<XCircle className="w-4 h-4" />} />
                    </CardContent>
                </Card>

                {/* Budget Risk Warnings */}
                {hasRisks ? (
                    <Card className="rounded-xl border border-red-200 shadow-sm" style={{ backgroundColor: "rgba(254,242,242,0.4)" }}>
                        <CardHeader className="pb-1">
                            <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                <p className="text-sm font-semibold text-slate-700">Budget Risk Warnings</p>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">Stores requiring attention</p>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-2">
                            {budgetRiskStores.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-red-600 mb-1.5 uppercase tracking-wide">Over Budget</p>
                                    {budgetRiskStores.map((s) => (
                                        <div key={s.name} className="flex items-center justify-between py-1.5 border-b border-red-50 last:border-0">
                                            <span className="text-sm text-slate-700 font-medium">{s.name}</span>
                                            <span className="text-xs font-semibold text-red-600">
                                                {formatCurrency(s.approved + s.pending)} / {formatCurrency(s.monthly_limit)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {highPendingStores.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-amber-600 mb-1.5 uppercase tracking-wide">High Pending (&gt;50% of limit)</p>
                                    {highPendingStores.map((s) => (
                                        <div key={s.name} className="flex items-center justify-between py-1.5 border-b border-amber-50 last:border-0">
                                            <span className="text-sm text-slate-700 font-medium">{s.name}</span>
                                            <span className="text-xs font-semibold text-amber-600">{formatCurrency(s.pending)} pending</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {highRejectionStores.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-orange-600 mb-1.5 uppercase tracking-wide">High Rejection Rate (&gt;30%)</p>
                                    {highRejectionStores.map((s) => (
                                        <div key={s.name} className="flex items-center justify-between py-1.5 border-b border-orange-50 last:border-0">
                                            <span className="text-sm text-slate-700 font-medium">{s.name}</span>
                                            <span className="text-xs font-semibold text-orange-600">{formatCurrency(s.rejected)} rejected</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <Card className="rounded-xl border border-slate-200 shadow-sm">
                        <CardContent className="flex flex-col items-center justify-center h-full py-10 gap-2 text-slate-400">
                            <CheckCircle2 className="w-8 h-8 text-emerald-300" />
                            <p className="text-sm font-medium">No budget risks detected</p>
                            <p className="text-xs text-slate-300">All stores within limits</p>
                        </CardContent>
                    </Card>
                )}
            </div>

        </PageShell>
    );
}