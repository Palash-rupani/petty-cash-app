"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
    AreaChart, Area,
    BarChart, Bar,
    LineChart, Line,
    PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
    TrendingUp, TrendingDown, Wallet, Receipt, Store,
    AlertTriangle, CheckCircle2, XCircle, Clock,
    RefreshCw, Download, Layers, BarChart2,
    Zap, ShieldAlert, Activity, Target,
    ArrowUpRight, ArrowDownRight, Minus,
    ChevronRight, ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Expense {
    id: string;
    amount: number;
    status: string;
    expense_month: string | null;
    created_at: string;
    updated_at: string | null;
    receipt_url: string | null;
    store_id: string;
    stores: { name: string; monthly_limit: number; cluster_id: string } | null;
    categories: { name: string } | null;
}

interface ClusterRow { id: string; name: string; }

// ─── Status Buckets ───────────────────────────────────────────────────────────

const APPROVED_STATUSES = ["accounting_approved", "synced_to_tally"] as const;
const PENDING_STATUSES = ["draft", "submitted", "cluster_approved"] as const;
const REJECTED_STATUSES = ["cluster_rejected", "accounting_rejected", "tally_sync_failed"] as const;
const ACCT_QUEUE = ["cluster_approved"] as const; // at accounting's door
const SYNCED_STATUS = "synced_to_tally";
const SYNC_FAIL_STATUS = "tally_sync_failed";

// ─── Colour palette ───────────────────────────────────────────────────────────

const C = {
    approved: "#10b981",
    pending: "#f59e0b",
    rejected: "#ef4444",
    synced: "#6366f1",
    neutral: "#94a3b8",
};

const PIE_PALETTE = [
    "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9",
    "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normaliseJoin<T>(value: T | T[] | null): T | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
}

function sumAmount(arr: Expense[]) { return arr.reduce((s, e) => s + e.amount, 0); }
function pct(n: number, d: number) { return d > 0 ? Math.round((n / d) * 100) : 0; }

function isoToLabel(d: string) {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function monthKey(d: string) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function daysBetween(a: string, b: string = new Date().toISOString()) {
    return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

const currencyFmt = (v: number | string) =>
    formatCurrency(typeof v === "number" ? v : Number(v));

function exportCSV(expenses: Expense[]) {
    const header = "ID,Date,Store,Category,Amount,Status,Receipt";
    const rows = expenses.map((e) =>
        [
            e.id,
            isoToLabel(e.created_at),
            e.stores?.name ?? "",
            e.categories?.name ?? "",
            e.amount,
            e.status,
            e.receipt_url ?? "",
        ].join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "expenses.csv"; a.click();
    URL.revokeObjectURL(url);
}

function exportSummaryCSV(clusterData: {
    name: string; total: number; approved: number; rejected: number; pending: number; count: number;
}[]) {
    const header = "Cluster,Total Spend,Approved,Rejected,Pending,Count";
    const rows = clusterData.map((c) =>
        [c.name, c.total, c.approved, c.rejected, c.pending, c.count].join(",")
    );
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "cluster-summary.csv"; a.click();
    URL.revokeObjectURL(url);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="p-6 max-w-screen-2xl mx-auto">{children}</div>;
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
    return (
        <div className="flex items-end gap-3 mb-4 mt-2">
            <div>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em]">{title}</h2>
                {sub && <p className="text-xs text-slate-300 mt-0.5">{sub}</p>}
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
        </div>
    );
}

function KpiCard({
    icon, bg, label, value, sub, subColor = "text-slate-400", trend,
}: {
    icon: React.ReactNode; bg: string; label: string; value: string;
    sub?: string; subColor?: string;
    trend?: "up" | "down" | "neutral";
}) {
    const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
    const trendColor = trend === "up" ? "text-emerald-500" : trend === "down" ? "text-red-500" : "text-slate-400";
    return (
        <Card className="rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardContent className="pt-5 pb-5">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl ${bg} flex-shrink-0`}>{icon}</div>
                        <div>
                            <p className="text-xs font-medium text-slate-500 leading-tight">{label}</p>
                            <p className="text-xl font-bold text-slate-900 mt-0.5 leading-tight tabular-nums">{value}</p>
                            {sub && <p className={`text-xs mt-0.5 font-medium ${subColor}`}>{sub}</p>}
                        </div>
                    </div>
                    {trend && <TrendIcon className={`w-4 h-4 flex-shrink-0 mt-1 ${trendColor}`} />}
                </div>
            </CardContent>
        </Card>
    );
}

function HealthBar({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">{label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>{value}%</span>
            </div>
            <div className={`h-2 w-full rounded-full overflow-hidden ${bg}`}>
                <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
                />
            </div>
        </div>
    );
}

function InsightCard({ icon, text, severity }: {
    icon: React.ReactNode; text: string; severity: "info" | "warning" | "danger" | "success";
}) {
    const styles = {
        info: "bg-blue-50 border-blue-100 text-blue-700",
        warning: "bg-amber-50 border-amber-100 text-amber-700",
        danger: "bg-red-50 border-red-100 text-red-700",
        success: "bg-emerald-50 border-emerald-100 text-emerald-700",
    };
    return (
        <div className={`flex items-start gap-3 p-3.5 rounded-xl border ${styles[severity]}`}>
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <p className="text-sm font-medium leading-snug">{text}</p>
        </div>
    );
}

function EmptyChart() {
    return (
        <div className="flex items-center justify-center h-48 text-slate-300 text-sm">
            No data available
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-5 animate-pulse">
            <div className="h-9 w-72 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-slate-100 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-64 bg-slate-100 rounded-2xl" />)}
            </div>
            <div className="h-72 bg-slate-100 rounded-2xl" />
            <div className="h-48 bg-slate-100 rounded-2xl" />
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccountingDashboardPage() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [clusters, setClusters] = useState<ClusterRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ── Fetch clusters ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!user || user.role !== "accounting") return;
        supabase.from("clusters").select("id, name").then(({ data, error }) => {
            if (error) setError(error.message);
            else setClusters((data ?? []) as ClusterRow[]);
        });
    }, [user]);

    // ── Fetch all expenses ───────────────────────────────────────────────────
    useEffect(() => {
        if (!user || user.role !== "accounting") return;
        setLoading(true);
        supabase
            .from("expenses")
            .select(
                "id, amount, status, expense_month, created_at, updated_at, receipt_url, store_id, " +
                "stores(name, monthly_limit, cluster_id), categories(name)"
            )
            .order("created_at", { ascending: false })
            .then(({ data, error }) => {
                setLoading(false);
                if (error) { setError(error.message); return; }
                const normalised = ((data ?? []) as any[]).map((row) => ({
                    ...row,
                    stores: normaliseJoin(row.stores),
                    categories: normaliseJoin(row.categories),
                })) as Expense[];
                setExpenses(normalised);
            });
    }, [user]);

    // ────────────────────────────────────────────────────────────────────────────
    // Derived — all memoised
    // ────────────────────────────────────────────────────────────────────────────

    const approved = useMemo(() => expenses.filter((e) => (APPROVED_STATUSES as readonly string[]).includes(e.status)), [expenses]);
    const pending = useMemo(() => expenses.filter((e) => (PENDING_STATUSES as readonly string[]).includes(e.status)), [expenses]);
    const rejected = useMemo(() => expenses.filter((e) => (REJECTED_STATUSES as readonly string[]).includes(e.status)), [expenses]);
    const acctQueue = useMemo(() => expenses.filter((e) => (ACCT_QUEUE as readonly string[]).includes(e.status)), [expenses]);
    const synced = useMemo(() => expenses.filter((e) => e.status === SYNCED_STATUS), [expenses]);
    const syncFail = useMemo(() => expenses.filter((e) => e.status === SYNC_FAIL_STATUS), [expenses]);

    const totalApproved = useMemo(() => sumAmount(approved), [approved]);
    const totalPending = useMemo(() => sumAmount(pending), [pending]);
    const totalRejected = useMemo(() => sumAmount(rejected), [rejected]);
    const avgExpense = useMemo(() => expenses.length ? totalApproved / approved.length || 0 : 0, [expenses, totalApproved, approved.length]);
    const largestExp = useMemo(() => expenses.length ? Math.max(...expenses.map((e) => e.amount)) : 0, [expenses]);

    const activeStores = useMemo(() => new Set(expenses.map((e) => e.store_id)).size, [expenses]);
    const activeClusters = useMemo(() => new Set(expenses.map((e) => e.stores?.cluster_id).filter(Boolean)).size, [expenses]);

    // Health rates
    const approvalRate = useMemo(() => pct(approved.length, expenses.length), [approved.length, expenses.length]);
    const rejectionRate = useMemo(() => pct(rejected.length, expenses.length), [rejected.length, expenses.length]);
    const pendingRate = useMemo(() => pct(pending.length, expenses.length), [pending.length, expenses.length]);
    const syncSuccessRate = useMemo(() => {
        const attempts = synced.length + syncFail.length;
        return pct(synced.length, attempts);
    }, [synced.length, syncFail.length]);

    // 12-month trend
    const monthlyTrend = useMemo(() => {
        const approvedMap: Record<string, number> = {};
        const rejectedMap: Record<string, number> = {};
        const countMap: Record<string, number> = {};
        expenses.forEach((e) => {
            const key = e.expense_month ? e.expense_month.slice(0, 7) : monthKey(e.created_at);
            countMap[key] = (countMap[key] ?? 0) + 1;
            if ((APPROVED_STATUSES as readonly string[]).includes(e.status))
                approvedMap[key] = (approvedMap[key] ?? 0) + e.amount;
            if ((REJECTED_STATUSES as readonly string[]).includes(e.status))
                rejectedMap[key] = (rejectedMap[key] ?? 0) + e.amount;
        });
        const months: { month: string; approved: number; rejected: number; count: number }[] = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(); d.setMonth(d.getMonth() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            months.push({ month: monthLabel(key), approved: approvedMap[key] ?? 0, rejected: rejectedMap[key] ?? 0, count: countMap[key] ?? 0 });
        }
        return months;
    }, [expenses]);

    // Cluster breakdown
    const clusterData = useMemo(() => {
        const clusterNameMap: Record<string, string> = {};
        clusters.forEach((c) => { clusterNameMap[c.id] = c.name; });
        const map: Record<string, { name: string; total: number; approved: number; rejected: number; pending: number; count: number }> = {};
        expenses.forEach((e) => {
            const cid = e.stores?.cluster_id ?? "unknown";
            if (!map[cid]) map[cid] = {
                name: clusterNameMap[cid] ?? cid,
                total: 0, approved: 0, rejected: 0, pending: 0, count: 0,
            };
            map[cid].count++;
            map[cid].total += e.amount;
            if ((APPROVED_STATUSES as readonly string[]).includes(e.status)) map[cid].approved += e.amount;
            if ((REJECTED_STATUSES as readonly string[]).includes(e.status)) map[cid].rejected += e.amount;
            if ((PENDING_STATUSES as readonly string[]).includes(e.status)) map[cid].pending += e.amount;
        });
        return Object.values(map).sort((a, b) => b.total - a.total);
    }, [expenses, clusters]);

    // Category breakdown (approved)
    const categoryData = useMemo(() => {
        const map: Record<string, number> = {};
        approved.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            map[k] = (map[k] ?? 0) + e.amount;
        });
        return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
    }, [approved]);

    // Category rejection rates
    const categoryRejection = useMemo(() => {
        const map: Record<string, { approved: number; rejected: number }> = {};
        expenses.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            if (!map[k]) map[k] = { approved: 0, rejected: 0 };
            if ((APPROVED_STATUSES as readonly string[]).includes(e.status)) map[k].approved++;
            if ((REJECTED_STATUSES as readonly string[]).includes(e.status)) map[k].rejected++;
        });
        return Object.entries(map)
            .map(([name, v]) => ({ name, ...v, rate: pct(v.rejected, v.approved + v.rejected) }))
            .sort((a, b) => b.rate - a.rate)
            .slice(0, 8);
    }, [expenses]);

    // Bottlenecks — pending > 3d and > 7d
    const pending3d = useMemo(() => pending.filter((e) => daysBetween(e.created_at) > 3), [pending]);
    const pending7d = useMemo(() => pending.filter((e) => daysBetween(e.created_at) > 7), [pending]);

    // Slow clusters (avg days pending)
    const slowClusters = useMemo(() => {
        const clusterNameMap: Record<string, string> = {};
        clusters.forEach((c) => { clusterNameMap[c.id] = c.name; });
        const map: Record<string, number[]> = {};
        pending.forEach((e) => {
            const cid = e.stores?.cluster_id ?? "unknown";
            if (!map[cid]) map[cid] = [];
            map[cid].push(daysBetween(e.created_at));
        });
        return Object.entries(map)
            .map(([cid, days]) => ({
                name: clusterNameMap[cid] ?? cid,
                avgDays: Math.round(days.reduce((a, b) => a + b, 0) / days.length),
                count: days.length,
            }))
            .filter((c) => c.avgDays > 3)
            .sort((a, b) => b.avgDays - a.avgDays);
    }, [pending, clusters]);

    // Store budget risk
    const storeBudgetRisk = useMemo(() => {
        const map: Record<string, { name: string; limit: number; spent: number; pending: number }> = {};
        expenses.forEach((e) => {
            const sid = e.store_id;
            if (!map[sid]) map[sid] = { name: e.stores?.name ?? sid, limit: e.stores?.monthly_limit ?? 0, spent: 0, pending: 0 };
            if ((APPROVED_STATUSES as readonly string[]).includes(e.status)) map[sid].spent += e.amount;
            if ((PENDING_STATUSES as readonly string[]).includes(e.status)) map[sid].pending += e.amount;
        });
        return Object.values(map)
            .filter((s) => s.limit > 0 && (s.spent + s.pending) > s.limit)
            .sort((a, b) => ((b.spent + b.pending) / b.limit) - ((a.spent + a.pending) / a.limit));
    }, [expenses]);

    // Tally sync queue table
    const syncFailQueue = useMemo(() => syncFail.slice(0, 10), [syncFail]);

    // Executive insights (dynamic)
    const insights = useMemo(() => {
        const out: { text: string; severity: "info" | "warning" | "danger" | "success"; icon: React.ReactNode }[] = [];

        // Highest rejecting cluster
        const sorted = [...clusterData].sort((a, b) => pct(b.rejected, b.total) - pct(a.rejected, a.total));
        if (sorted.length > 0 && pct(sorted[0].rejected, sorted[0].total) > 10)
            out.push({ text: `${sorted[0].name} has the highest rejection rate at ${pct(sorted[0].rejected, sorted[0].total)}% of total cluster spend.`, severity: "warning", icon: <AlertTriangle className="w-4 h-4" /> });

        // Pending increase vs previous month
        const lastTwo = monthlyTrend.slice(-2);
        if (lastTwo.length === 2 && lastTwo[0].count > 0) {
            const growth = pct(lastTwo[1].count - lastTwo[0].count, lastTwo[0].count);
            if (Math.abs(growth) >= 15)
                out.push({ text: `Expense volume ${growth > 0 ? "increased" : "decreased"} ${Math.abs(growth)}% vs the previous month.`, severity: growth > 0 ? "info" : "success", icon: growth > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" /> });
        }

        // Budget overrun stores
        if (storeBudgetRisk.length > 0)
            out.push({ text: `${storeBudgetRisk.length} store${storeBudgetRisk.length > 1 ? "s are" : " is"} exceeding monthly budget limits. Highest offender: ${storeBudgetRisk[0].name}.`, severity: "danger", icon: <ShieldAlert className="w-4 h-4" /> });

        // Old pending queue
        if (pending7d.length > 0)
            out.push({ text: `${pending7d.length} expense${pending7d.length > 1 ? "s have" : " has"} been pending approval for over 7 days — review required.`, severity: "warning", icon: <Clock className="w-4 h-4" /> });

        // Top category
        if (categoryData.length > 0)
            out.push({ text: `"${categoryData[0].name}" is the highest-spend category at ${formatCurrency(categoryData[0].value)} approved.`, severity: "info", icon: <Activity className="w-4 h-4" /> });

        // Tally failures
        if (syncFail.length > 0)
            out.push({ text: `${syncFail.length} expense${syncFail.length > 1 ? "s" : ""} failed Tally sync and require manual review.`, severity: "danger", icon: <RefreshCw className="w-4 h-4" /> });

        // Approval rate healthy
        if (approvalRate >= 80)
            out.push({ text: `Overall approval rate is strong at ${approvalRate}%. The pipeline is healthy.`, severity: "success", icon: <CheckCircle2 className="w-4 h-4" /> });

        // Low sync rate
        if (synced.length + syncFail.length > 0 && syncSuccessRate < 90)
            out.push({ text: `Tally sync success rate is ${syncSuccessRate}% — below the recommended 90% threshold.`, severity: "warning", icon: <Zap className="w-4 h-4" /> });

        return out.slice(0, 8);
    }, [clusterData, monthlyTrend, storeBudgetRisk, pending7d, categoryData, syncFail, approvalRate, syncSuccessRate, synced.length]);

    // ── Guards ───────────────────────────────────────────────────────────────
    if (authLoading) return <PageShell><LoadingState /></PageShell>;

    if (!user || user.role !== "accounting") {
        return (
            <PageShell>
                <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
                    <ShieldAlert className="w-12 h-12 text-slate-200" />
                    <p className="text-base font-semibold text-slate-500">Access restricted to Accounting team members.</p>
                </div>
            </PageShell>
        );
    }

    if (error) return <PageShell><p className="text-red-500 p-6">{error}</p></PageShell>;

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <PageShell>

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
                <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">Finance Intelligence</p>
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Executive Dashboard</h1>
                    <p className="text-sm text-slate-500 mt-1 font-medium">
                        Organisation-wide petty cash analytics · {expenses.length} total expenses
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => exportCSV(expenses)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors shadow-sm"
                    >
                        <Download className="w-4 h-4" /> Export CSV
                    </button>
                    <button
                        onClick={() => exportSummaryCSV(clusterData)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm"
                    >
                        <BarChart2 className="w-4 h-4" /> Cluster Summary
                    </button>
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — GLOBAL KPI CARDS
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Global KPIs" />
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-8">
                <KpiCard icon={<Wallet className="w-4 h-4 text-indigo-600" />} bg="bg-indigo-50" label="Approved Spend" value={formatCurrency(totalApproved)} trend="up" />
                <KpiCard icon={<Clock className="w-4 h-4 text-amber-500" />} bg="bg-amber-50" label="Pending (Acct.)" value={String(acctQueue.length)} sub={formatCurrency(sumAmount(acctQueue))} subColor="text-amber-600" trend="neutral" />
                <KpiCard icon={<XCircle className="w-4 h-4 text-red-500" />} bg="bg-red-50" label="Rejected Amount" value={formatCurrency(totalRejected)} trend="down" />
                <KpiCard icon={<Receipt className="w-4 h-4 text-violet-600" />} bg="bg-violet-50" label="Total Expenses" value={String(expenses.length)} />
                <KpiCard icon={<TrendingUp className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50" label="Avg. Expense" value={formatCurrency(avgExpense)} />
                <KpiCard icon={<ArrowUpRight className="w-4 h-4 text-sky-600" />} bg="bg-sky-50" label="Largest Expense" value={formatCurrency(largestExp)} />
                <KpiCard icon={<Store className="w-4 h-4 text-rose-600" />} bg="bg-rose-50" label="Active Stores" value={String(activeStores)} />
                <KpiCard icon={<Layers className="w-4 h-4 text-teal-600" />} bg="bg-teal-50" label="Active Clusters" value={String(activeClusters)} />
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — FINANCIAL HEALTH OVERVIEW
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Financial Health" sub="Organisation-wide ratios" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Approval Pipeline Health</p>
                        <p className="text-xs text-slate-400">Breakdown of all {expenses.length} expenses</p>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                        <HealthBar label="Approval Rate" value={approvalRate} color={C.approved} bg="bg-emerald-50" />
                        <HealthBar label="Pending Rate" value={pendingRate} color={C.pending} bg="bg-amber-50" />
                        <HealthBar label="Rejection Rate" value={rejectionRate} color={C.rejected} bg="bg-red-50" />
                        <HealthBar label="Tally Sync Success" value={syncSuccessRate} color={C.synced} bg="bg-indigo-50" />
                    </CardContent>
                </Card>

                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Status Distribution</p>
                        <p className="text-xs text-slate-400">Amount split across pipeline stages</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {expenses.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={190}>
                                <PieChart>
                                    <Pie
                                        data={[
                                            { name: "Approved", value: totalApproved },
                                            { name: "Pending", value: totalPending },
                                            { name: "Rejected", value: totalRejected },
                                        ].filter((d) => d.value > 0)}
                                        cx="50%" cy="50%"
                                        innerRadius={52} outerRadius={80}
                                        dataKey="value" paddingAngle={3}
                                    >
                                        <Cell fill={C.approved} />
                                        <Cell fill={C.pending} />
                                        <Cell fill={C.rejected} />
                                    </Pie>
                                    <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — CLUSTER COMPARISON
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Cluster Comparison" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-8">

                {/* Grouped bar */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Spend by Cluster</p>
                        <p className="text-xs text-slate-400">Approved · Pending · Rejected</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {clusterData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={clusterData.slice(0, 8)} barSize={8} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={38} />
                                    <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
                                    <Bar dataKey="approved" name="Approved" fill={C.approved} radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="pending" name="Pending" fill={C.pending} radius={[3, 3, 0, 0]} />
                                    <Bar dataKey="rejected" name="Rejected" fill={C.rejected} radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Cluster detail table */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <CardHeader className="border-b border-slate-100 pb-3">
                        <p className="text-sm font-semibold text-slate-700">Cluster Detail Table</p>
                        <p className="text-xs text-slate-400">Approval efficiency per cluster</p>
                    </CardHeader>
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="h-28 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
                        ) : clusterData.length === 0 ? (
                            <div className="h-28 flex items-center justify-center text-slate-300 text-sm">No data</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {["Cluster", "Approved", "Rejected", "Pending", "Count", "Efficiency"].map((h) => (
                                                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {clusterData.map((c, i) => (
                                            <tr key={c.name} className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                                <td className="px-4 py-2.5 font-semibold text-slate-800">{c.name}</td>
                                                <td className="px-4 py-2.5 text-emerald-700 font-semibold tabular-nums">{formatCurrency(c.approved)}</td>
                                                <td className="px-4 py-2.5 text-red-600 font-semibold tabular-nums">{formatCurrency(c.rejected)}</td>
                                                <td className="px-4 py-2.5 text-amber-600 font-semibold tabular-nums">{formatCurrency(c.pending)}</td>
                                                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{c.count}</td>
                                                <td className="px-4 py-2.5">
                                                    <span className={`text-xs font-bold ${pct(c.approved, c.total) >= 70 ? "text-emerald-600" : pct(c.approved, c.total) >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                                        {pct(c.approved, c.total)}%
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — MONTHLY TREND (12 months)
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Monthly Trends" sub="12-month view" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-8">

                {/* Area chart — approved vs rejected */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Approved vs Rejected Spend</p>
                        <p className="text-xs text-slate-400">12-month area trend</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {monthlyTrend.every((d) => d.approved === 0 && d.rejected === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={220}>
                                <AreaChart data={monthlyTrend} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                                    <defs>
                                        <linearGradient id="gradApp" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={C.approved} stopOpacity={0.18} />
                                            <stop offset="95%" stopColor={C.approved} stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradRej" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={C.rejected} stopOpacity={0.15} />
                                            <stop offset="95%" stopColor={C.rejected} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={36} />
                                    <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
                                    <Area type="monotone" dataKey="approved" name="Approved" stroke={C.approved} strokeWidth={2} fill="url(#gradApp)" dot={false} activeDot={{ r: 4 }} />
                                    <Area type="monotone" dataKey="rejected" name="Rejected" stroke={C.rejected} strokeWidth={2} fill="url(#gradRej)" dot={false} activeDot={{ r: 4 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Line chart — expense count */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Monthly Expense Volume</p>
                        <p className="text-xs text-slate-400">Number of expenses submitted per month</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {monthlyTrend.every((d) => d.count === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={220}>
                                <LineChart data={monthlyTrend} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={28} />
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Line type="monotone" dataKey="count" name="Expenses" stroke={C.synced} strokeWidth={2.5}
                                        dot={{ r: 3, fill: C.synced, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5 — CATEGORY ANALYTICS
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Category Analytics" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-8">

                {/* Category spend pie */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Top Spending Categories</p>
                        <p className="text-xs text-slate-400">Approved expenses only</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {categoryData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={220}>
                                <PieChart>
                                    <Pie data={categoryData} cx="50%" cy="50%" outerRadius={90}
                                        dataKey="value" paddingAngle={2}>
                                        {categoryData.map((_, i) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={currencyFmt as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-xs text-slate-600">{v}</span>} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Category rejection rates */}
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Category Rejection Rates</p>
                        <p className="text-xs text-slate-400">% of expenses rejected per category</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {categoryRejection.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={220}>
                                <BarChart data={categoryRejection} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide domain={[0, 100]} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={((v: number | string) => `${v}%`) as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    <Bar dataKey="rate" name="Rejection %" radius={[0, 4, 4, 0]}>
                                        {categoryRejection.map((entry, i) => (
                                            <Cell key={i} fill={entry.rate > 30 ? C.rejected : entry.rate > 15 ? C.pending : C.approved} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 6 — APPROVAL BOTTLENECKS
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Bottlenecks" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <Card className={`rounded-2xl border shadow-sm ${pending3d.length > 0 ? "border-amber-200 bg-amber-50/30" : "border-slate-200"}`}>
                    <CardContent className="pt-5 pb-5">
                        <div className="flex items-start gap-3">
                            <div className="p-2.5 rounded-xl bg-amber-100 flex-shrink-0"><Clock className="w-4 h-4 text-amber-600" /></div>
                            <div>
                                <p className="text-xs font-medium text-slate-500">Pending &gt; 3 Days</p>
                                <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{pending3d.length}</p>
                                <p className="text-xs text-amber-600 font-medium mt-0.5">{formatCurrency(sumAmount(pending3d))} held</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className={`rounded-2xl border shadow-sm ${pending7d.length > 0 ? "border-red-200 bg-red-50/30" : "border-slate-200"}`}>
                    <CardContent className="pt-5 pb-5">
                        <div className="flex items-start gap-3">
                            <div className="p-2.5 rounded-xl bg-red-100 flex-shrink-0"><AlertTriangle className="w-4 h-4 text-red-600" /></div>
                            <div>
                                <p className="text-xs font-medium text-slate-500">Pending &gt; 7 Days</p>
                                <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{pending7d.length}</p>
                                <p className="text-xs text-red-600 font-medium mt-0.5">{formatCurrency(sumAmount(pending7d))} held</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border border-slate-200 shadow-sm">
                    <CardContent className="pt-5 pb-5">
                        <div className="flex items-start gap-3">
                            <div className="p-2.5 rounded-xl bg-indigo-50 flex-shrink-0"><Target className="w-4 h-4 text-indigo-600" /></div>
                            <div>
                                <p className="text-xs font-medium text-slate-500">Acct. Pending Queue</p>
                                <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{acctQueue.length}</p>
                                <p className="text-xs text-indigo-600 font-medium mt-0.5">{formatCurrency(sumAmount(acctQueue))} awaiting</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Slow clusters table */}
            {slowClusters.length > 0 && (
                <Card className="rounded-2xl border border-amber-200 shadow-sm mb-8 overflow-hidden" style={{ backgroundColor: "rgba(254,243,199,0.2)" }}>
                    <CardHeader className="border-b border-amber-100 pb-3">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-500" />
                            <p className="text-sm font-semibold text-slate-700">Slow Approval Clusters</p>
                            <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                Avg wait &gt; 3 days
                            </span>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-amber-50 border-b border-amber-100">
                                    {["Cluster", "Pending Expenses", "Avg. Days Waiting"].map((h) => (
                                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {slowClusters.map((c, i) => (
                                    <tr key={c.name} className={`border-b border-amber-50 hover:bg-amber-50/60 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-amber-50/20"}`}>
                                        <td className="px-4 py-2.5 font-semibold text-slate-800">{c.name}</td>
                                        <td className="px-4 py-2.5 text-slate-600">{c.count}</td>
                                        <td className="px-4 py-2.5">
                                            <span className={`text-xs font-bold ${c.avgDays > 7 ? "text-red-600" : "text-amber-600"}`}>
                                                {c.avgDays} days
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 7 — BUDGET RISK MONITORING
      ══════════════════════════════════════════════════════════════════════ */}
            {storeBudgetRisk.length > 0 && (
                <>
                    <SectionHeading title="Budget Risk Monitoring" />
                    <Card className="rounded-2xl border border-red-200 shadow-sm mb-8 overflow-hidden" style={{ backgroundColor: "rgba(254,242,242,0.35)" }}>
                        <CardHeader className="border-b border-red-100 pb-3">
                            <div className="flex items-center gap-2">
                                <ShieldAlert className="w-4 h-4 text-red-500" />
                                <p className="text-sm font-semibold text-slate-700">Stores Exceeding Monthly Budget</p>
                                <span className="ml-auto text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                                    {storeBudgetRisk.length} store{storeBudgetRisk.length > 1 ? "s" : ""}
                                </span>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-red-50/60 border-b border-red-100">
                                        {["Store", "Monthly Limit", "Approved + Pending", "Over By", "% Used"].map((h) => (
                                            <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {storeBudgetRisk.map((s, i) => {
                                        const total = s.spent + s.pending;
                                        const over = total - s.limit;
                                        const usedP = pct(total, s.limit);
                                        return (
                                            <tr key={s.name} className={`border-b border-red-50 hover:bg-red-50/40 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-red-50/20"}`}>
                                                <td className="px-4 py-2.5 font-semibold text-slate-800">{s.name}</td>
                                                <td className="px-4 py-2.5 text-slate-600 tabular-nums">{formatCurrency(s.limit)}</td>
                                                <td className="px-4 py-2.5 text-slate-800 font-semibold tabular-nums">{formatCurrency(total)}</td>
                                                <td className="px-4 py-2.5 text-red-600 font-bold tabular-nums">{formatCurrency(over)}</td>
                                                <td className="px-4 py-2.5">
                                                    <span className="text-xs font-bold text-red-700">{usedP}%</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 8 — TALLY SYNC MONITORING
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Tally Sync Monitoring" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <KpiCard icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} bg="bg-emerald-50"
                    label="Synced to Tally" value={String(synced.length)} sub={formatCurrency(sumAmount(synced))} subColor="text-emerald-600" trend="up" />
                <KpiCard icon={<XCircle className="w-4 h-4 text-red-500" />} bg="bg-red-50"
                    label="Sync Failures" value={String(syncFail.length)} sub={formatCurrency(sumAmount(syncFail))} subColor="text-red-500" trend="down" />
                <KpiCard icon={<Activity className="w-4 h-4 text-indigo-600" />} bg="bg-indigo-50"
                    label="Sync Success Rate" value={`${syncSuccessRate}%`} sub={`${synced.length + syncFail.length} attempts`} />
                <KpiCard icon={<RefreshCw className="w-4 h-4 text-amber-500" />} bg="bg-amber-50"
                    label="Retry Required" value={String(syncFail.length)} sub="Manual review needed" subColor="text-amber-600" />
            </div>

            {syncFailQueue.length > 0 && (
                <Card className="rounded-2xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                    <CardHeader className="border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-amber-500" />
                            <p className="text-sm font-semibold text-slate-700">Failed Sync Queue</p>
                            <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                {syncFail.length} item{syncFail.length > 1 ? "s" : ""}
                            </span>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Date", "Store", "Category", "Amount", "Status", "Receipt"].map((h) => (
                                            <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {syncFailQueue.map((e, i) => (
                                        <tr key={e.id} className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                            <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                            <td className="px-4 py-2.5 text-slate-700 font-medium">{e.stores?.name ?? "—"}</td>
                                            <td className="px-4 py-2.5 text-slate-600">{e.categories?.name ?? "—"}</td>
                                            <td className="px-4 py-2.5 font-semibold text-slate-900 tabular-nums">{formatCurrency(e.amount)}</td>
                                            <td className="px-4 py-2.5"><Badge status={e.status as any} /></td>
                                            <td className="px-4 py-2.5">
                                                {e.receipt_url ? (
                                                    <a href={e.receipt_url} target="_blank" rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium">
                                                        View <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                ) : <span className="text-slate-300 text-xs">—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION 9 — EXECUTIVE INSIGHTS
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Executive Insights" sub="Dynamically generated from live data" />
            {insights.length === 0 ? (
                <Card className="rounded-2xl border border-slate-200 shadow-sm mb-8">
                    <CardContent className="flex items-center justify-center h-24 text-slate-300 text-sm">
                        No insights generated yet — load more data.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                    {insights.map((ins, i) => (
                        <InsightCard key={i} icon={ins.icon} text={ins.text} severity={ins.severity} />
                    ))}
                </div>
            )}

        </PageShell>
    );
}