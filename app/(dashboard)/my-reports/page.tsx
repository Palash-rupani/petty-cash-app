"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
    RadialBarChart,
    RadialBar,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    CartesianGrid,
    PieChart,
    Pie,
    Cell,
    Legend,
} from "recharts";
import {
    TrendingUp,
    Wallet,
    Receipt,
    ArrowUpCircle,
    ExternalLink,
    CalendarDays,
    Clock,
    XCircle,
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeRange = "this_month" | "last_3_months" | "custom";
type StatusFilter = "all" | "approved" | "pending" | "rejected";

interface Expense {
    id: string;
    amount: number;
    status: string;
    expense_month: string;
    created_at: string;
    receipt_url: string | null;
    categories: { name: string } | null;
}

interface StoreInfo {
    name: string;
    monthly_limit: number;
}

// ─── Status Groups ────────────────────────────────────────────────────────────

const APPROVED_STATUSES = ["accounting_approved", "synced_to_tally"];
const PENDING_STATUSES = ["draft", "submitted", "cluster_approved"];
const REJECTED_STATUSES = ["cluster_rejected", "accounting_rejected", "tally_sync_failed"];
// Subset for the "awaiting approval" table (excludes raw drafts)
const IN_REVIEW_STATUSES = ["submitted", "cluster_approved"];

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


function getDateRange(range: TimeRange, customFrom: string, customTo: string) {
    const now = new Date();
    if (range === "this_month") {
        return {
            from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
            to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
        };
    }
    if (range === "last_3_months") {
        return {
            from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(),
            to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
        };
    }
    return {
        from: customFrom ? new Date(customFrom).toISOString() : "",
        to: customTo ? new Date(customTo + "T23:59:59").toISOString() : "",
    };
}

function pct(part: number, total: number) {
    return total > 0 ? Math.min((part / total) * 100, 100) : 0;
}

// ─── Pie colours ──────────────────────────────────────────────────────────────

const PIE_COLORS = { approved: "#22c55e", pending: "#f59e0b", rejected: "#ef4444" };

// ─── Budget Gauge ─────────────────────────────────────────────────────────────

function BudgetGauge({ used, limit }: { used: number; limit: number }) {
    const p = pct(used, limit);
    const color = p < 60 ? "#22c55e" : p < 85 ? "#f59e0b" : "#ef4444";
    return (
        <div className="flex flex-col items-center justify-center h-52">
            <ResponsiveContainer width="100%" height={180}>
                <RadialBarChart
                    cx="50%" cy="80%" innerRadius="60%" outerRadius="100%"
                    startAngle={180} endAngle={0}
                    data={[{ name: "used", value: p, fill: color }]}
                    barSize={18}
                >
                    <RadialBar background={{ fill: "#e2e8f0" }} dataKey="value" cornerRadius={8} />
                </RadialBarChart>
            </ResponsiveContainer>
            <div className="flex flex-col items-center -mt-10">
                <span className="text-3xl font-bold" style={{ color }}>{p.toFixed(1)}%</span>
                <span className="text-xs text-slate-500 mt-0.5">of monthly budget used</span>
            </div>
        </div>
    );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value, color }: { value: number; color: string }) {
    return (
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
            />
        </div>
    );
}

// ─── Funnel Step ──────────────────────────────────────────────────────────────

function FunnelStep({ label, count, amount, color, icon }: {
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StoreManagerReportPage() {
    const { user, loading: authLoading } = useAuth();
    const supabase = createClient();

    const [store, setStore] = useState<StoreInfo | null>(null);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [trendData, setTrendData] = useState<{ month: string; amount: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [timeRange, setTimeRange] = useState<TimeRange>("this_month");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");

    // ── Fetch store info ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!user?.store_id) return;
        supabase.from("stores").select("name, monthly_limit")
            .eq("id", user.store_id).single()
            .then(({ data, error }) => {
                if (error) setError(error.message); else setStore(data);
            });
    }, [user?.store_id]);

    // ── Fetch expenses in date range ─────────────────────────────────────────
    useEffect(() => {
        if (!user?.store_id) return;
        if (timeRange === "custom" && (!customFrom || !customTo)) return;
        const { from, to } = getDateRange(timeRange, customFrom, customTo);
        setLoading(true);
        supabase.from("expenses")
            .select("id, amount, status, expense_month, created_at, receipt_url, categories(name)")
            .eq("store_id", user.store_id)
            .gte("created_at", from).lte("created_at", to)
            .order("created_at", { ascending: false })
            .then(({ data, error }) => {
                setLoading(false);
                if (error) { setError(error.message); return; }
                // Normalise the categories join: Supabase can return an array; we want the first element.
                const normalised = (data ?? []).map((row) => ({
                    ...row,
                    categories: Array.isArray(row.categories)
                        ? (row.categories[0] ?? null)
                        : row.categories,
                })) as Expense[];
                setExpenses(normalised);
            });
    }, [user?.store_id, timeRange, customFrom, customTo]);

    // ── Fetch 6-month approved trend ─────────────────────────────────────────
    useEffect(() => {
        if (!user?.store_id) return;
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        supabase.from("expenses")
            .select("amount, expense_month, status, created_at")   // added created_at
            .eq("store_id", user.store_id)
            .in("status", APPROVED_STATUSES)
            .gte("created_at", sixMonthsAgo.toISOString())
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
    }, [user?.store_id]);

    // ────────────────────────────────────────────────────────────────────────────
    // Derived calculations — all memoised, no extra queries
    // ────────────────────────────────────────────────────────────────────────────

    const approved = useMemo(() => expenses.filter((e) => APPROVED_STATUSES.includes(e.status)), [expenses]);
    const pending = useMemo(() => expenses.filter((e) => PENDING_STATUSES.includes(e.status)), [expenses]);
    const rejected = useMemo(() => expenses.filter((e) => REJECTED_STATUSES.includes(e.status)), [expenses]);
    const drafts = useMemo(() => expenses.filter((e) => e.status === "draft"), [expenses]);

    const totalApproved = useMemo(() => approved.reduce((s, e) => s + e.amount, 0), [approved]);
    const totalPending = useMemo(() => pending.reduce((s, e) => s + e.amount, 0), [pending]);
    const totalRejected = useMemo(() => rejected.reduce((s, e) => s + e.amount, 0), [rejected]);
    const largestExpense = useMemo(
        () => (expenses.length ? Math.max(...expenses.map((e) => e.amount)) : 0),
        [expenses]
    );

    const monthlyLimit = store?.monthly_limit ?? 0;
    const budgetRemaining = monthlyLimit - totalApproved;
    const approvedPct = pct(totalApproved, monthlyLimit);
    const pendingPct = pct(totalPending, monthlyLimit);
    const combinedPct = pct(totalApproved + totalPending, monthlyLimit);
    const budgetOverWarning = combinedPct > 100;

    // Approved category breakdown
    const categoryData = useMemo(() => {
        const map: Record<string, number> = {};
        approved.forEach((e) => { const k = e.categories?.name ?? "Uncategorized"; map[k] = (map[k] ?? 0) + e.amount; });
        return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
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
            .sort((a, b) => b.count - a.count);
    }, [rejected]);

    // Pending approval table (submitted / cluster_approved only)
    const pendingApprovalRows = useMemo(
        () => expenses.filter((e) => IN_REVIEW_STATUSES.includes(e.status)),
        [expenses]
    );

    // Pie chart data
    const pieData = useMemo(() => [
        { name: "Approved", value: totalApproved, color: PIE_COLORS.approved },
        { name: "Pending", value: totalPending, color: PIE_COLORS.pending },
        { name: "Rejected", value: totalRejected, color: PIE_COLORS.rejected },
    ].filter((d) => d.value > 0), [totalApproved, totalPending, totalRejected]);

    // Filtered detail table
    const filteredExpenses = useMemo(() => {
        if (statusFilter === "all") return expenses;
        if (statusFilter === "approved") return approved;
        if (statusFilter === "pending") return pending;
        if (statusFilter === "rejected") return rejected;
        return expenses;
    }, [expenses, statusFilter, approved, pending, rejected]);

    // Funnel totals
    const draftTotal = useMemo(() => drafts.reduce((s, e) => s + e.amount, 0), [drafts]);
    const inReviewTotal = useMemo(() => pendingApprovalRows.reduce((s, e) => s + e.amount, 0), [pendingApprovalRows]);

    // ── Guards ───────────────────────────────────────────────────────────────
    if (authLoading) return <PageShell><LoadingState /></PageShell>;
    if (!user || user.role !== "store_manager") {
        return (
            <PageShell>
                <div className="flex items-center justify-center h-64 text-slate-500">
                    Access restricted to Store Managers.
                </div>
            </PageShell>
        );
    }
    if (error) return <PageShell><p className="text-red-500 p-6">{error}</p></PageShell>;

    // ── Tooltip formatter (typed to satisfy Recharts) ────────────────────────
    const currencyFormatter = (value: number | string) =>
        formatCurrency(typeof value === "number" ? value : Number(value));

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <PageShell>

            {/* ── Header ── */}
            <div className="flex flex-col gap-1 mb-6">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Store Report</h1>
                {store && (
                    <p className="text-sm text-slate-500 font-medium">
                        {store.name} · Monthly Limit: {formatCurrency(monthlyLimit)}
                    </p>
                )}
            </div>

            {/* ── Filters ── */}
            <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                {/* Time range */}
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                    {(["this_month", "last_3_months", "custom"] as TimeRange[]).map((r) => (
                        <button key={r} onClick={() => setTimeRange(r)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${timeRange === r ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                                }`}>
                            {r === "this_month" ? "This Month" : r === "last_3_months" ? "Last 3 Months" : "Custom"}
                        </button>
                    ))}
                </div>

                {/* Custom date pickers */}
                {timeRange === "custom" && (
                    <div className="flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-slate-400" />
                        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        <span className="text-slate-400 text-sm">to</span>
                        <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                )}

                <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />

                {/* Status filter */}
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                    {(["all", "approved", "pending", "rejected"] as StatusFilter[]).map((s) => (
                        <button key={s} onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${statusFilter === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                                }`}>
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION A — Core Stats
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Overview" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                <StatCard icon={<Wallet className="w-5 h-5 text-indigo-600" />} bg="bg-indigo-50"
                    label="Total Spent (Approved)" value={formatCurrency(totalApproved)} />
                <StatCard icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} bg="bg-emerald-50"
                    label="Budget Remaining" value={formatCurrency(Math.max(budgetRemaining, 0))}
                    sub={budgetRemaining < 0 ? "Over budget" : undefined} subColor="text-red-500" />
                <StatCard icon={<Receipt className="w-5 h-5 text-violet-600" />} bg="bg-violet-50"
                    label="Number of Expenses" value={String(expenses.length)} />
                <StatCard icon={<ArrowUpCircle className="w-5 h-5 text-amber-600" />} bg="bg-amber-50"
                    label="Largest Expense" value={formatCurrency(largestExpense)} />
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION B — Approval Status Summary
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Status Summary" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                <StatCard icon={<Clock className="w-5 h-5 text-amber-500" />} bg="bg-amber-50"
                    label="Pending Expenses" value={String(pending.length)}
                    sub={`${formatCurrency(totalPending)} held`} subColor="text-amber-600" />
                <StatCard icon={<Wallet className="w-5 h-5 text-amber-500" />} bg="bg-amber-50"
                    label="Pending Amount" value={formatCurrency(totalPending)}
                    sub={`${pendingPct.toFixed(1)}% of monthly limit`} subColor="text-amber-600" />
                <StatCard icon={<XCircle className="w-5 h-5 text-red-500" />} bg="bg-red-50"
                    label="Rejected Expenses" value={String(rejected.length)}
                    sub={rejected.length > 0 ? `${formatCurrency(totalRejected)} total` : "None this period"}
                    subColor="text-red-500" />
                <StatCard icon={<Wallet className="w-5 h-5 text-red-500" />} bg="bg-red-50"
                    label="Rejected Amount" value={formatCurrency(totalRejected)}
                    sub={rejected.length > 0 ? `Across ${rejected.length} expense${rejected.length > 1 ? "s" : ""}` : undefined}
                    subColor="text-red-500" />
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION C — Spend Analytics
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Spend Analytics" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

                {/* Budget Gauge */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-0">
                        <p className="text-sm font-semibold text-slate-700">Budget Health</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <BudgetGauge used={totalApproved} limit={monthlyLimit} />
                        <div className="flex justify-between text-xs text-slate-400 px-2 mt-1 mb-4">
                            <span>{formatCurrency(0)}</span>
                            <span>{formatCurrency(monthlyLimit)}</span>
                        </div>
                        <div className="space-y-3 px-1">
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500">Approved spend</span>
                                    <span className="font-semibold text-emerald-600">{approvedPct.toFixed(1)}%</span>
                                </div>
                                <ProgressBar value={approvedPct} color="#22c55e" />
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-slate-500">Pending (not yet approved)</span>
                                    <span className="font-semibold text-amber-500">{pendingPct.toFixed(1)}%</span>
                                </div>
                                <ProgressBar value={pendingPct} color="#f59e0b" />
                            </div>
                            {budgetOverWarning && (
                                <div className="flex items-start gap-1.5 mt-1 p-2.5 bg-red-50 border border-red-100 rounded-lg">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-xs text-red-600 font-medium leading-snug">
                                        Approved + pending ({combinedPct.toFixed(0)}%) exceeds your monthly limit
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Spend by category */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Spend by Category</p>
                        <p className="text-xs text-slate-400">Approved expenses only</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {categoryData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={categoryData} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        formatter={currencyFormatter as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                    />
                                    <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Monthly trend */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <p className="text-sm font-semibold text-slate-700">Monthly Trend</p>
                        <p className="text-xs text-slate-400">Approved spend, last 6 months</p>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {trendData.every((d) => d.amount === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                                        tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                                        width={36}
                                    />
                                    <Tooltip
                                        formatter={currencyFormatter as never}
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
          SECTION D — Approval Funnel + Pie
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Funnel" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

                {/* Funnel steps */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-1">
                        <p className="text-sm font-semibold text-slate-700">Expense Pipeline</p>
                        <p className="text-xs text-slate-400">Breakdown by stage</p>
                    </CardHeader>
                    <CardContent>
                        <FunnelStep label="Draft" count={drafts.length} amount={draftTotal}
                            color="#94a3b8" icon={<Receipt className="w-4 h-4" />} />
                        <FunnelStep label="Submitted / In Review" count={pendingApprovalRows.length}
                            amount={inReviewTotal} color="#f59e0b" icon={<Clock className="w-4 h-4" />} />
                        <FunnelStep label="Approved" count={approved.length} amount={totalApproved}
                            color="#22c55e" icon={<CheckCircle2 className="w-4 h-4" />} />
                        <FunnelStep label="Rejected" count={rejected.length} amount={totalRejected}
                            color="#ef4444" icon={<XCircle className="w-4 h-4" />} />
                    </CardContent>
                </Card>

                {/* Pie: Amount distribution */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <CardHeader className="pb-1">
                        <p className="text-sm font-semibold text-slate-700">Amount Distribution</p>
                        <p className="text-xs text-slate-400">Approved vs Pending vs Rejected</p>
                    </CardHeader>
                    <CardContent>
                        {pieData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <PieChart>
                                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={54} outerRadius={82}
                                        dataKey="value" paddingAngle={3}>
                                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                    </Pie>
                                    <Tooltip
                                        formatter={currencyFormatter as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                                    />
                                    <Legend iconType="circle" iconSize={8}
                                        formatter={(value) => <span className="text-xs text-slate-600">{value}</span>} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION E — Rejection Insights (conditional)
      ══════════════════════════════════════════════════════════════════════ */}
            {rejected.length > 0 && (
                <>
                    <SectionHeading title="Rejection Insights" />
                    <Card className="rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
                        <CardHeader className="border-b border-slate-100 pb-3">
                            <p className="text-sm font-semibold text-slate-700">Top Rejection Categories</p>
                            <p className="text-xs text-slate-400">Expenses rejected at any stage</p>
                        </CardHeader>
                        <CardContent className="p-0">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Category", "Rejections", "Rejected Amount"].map((h) => (
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
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════════
          SECTION F — Pending Approval Table (conditional)
      ══════════════════════════════════════════════════════════════════════ */}
            {pendingApprovalRows.length > 0 && (
                <>
                    <SectionHeading title="Awaiting Approval" />
                    <Card className="rounded-xl border border-amber-200 shadow-sm mb-6 overflow-hidden" style={{ backgroundColor: "rgba(254,243,199,0.15)" }}>
                        <CardHeader className="border-b border-amber-100 pb-3">
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-amber-500" />
                                <p className="text-sm font-semibold text-slate-700">Pending Approval</p>
                                <span className="ml-auto text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                    {pendingApprovalRows.length} expense{pendingApprovalRows.length > 1 ? "s" : ""}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Submitted or awaiting cluster manager sign-off · {formatCurrency(inReviewTotal)} held
                            </p>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-amber-50 border-b border-amber-100">
                                            {["Date", "Category", "Amount", "Current Status"].map((h) => (
                                                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pendingApprovalRows.map((e, i) => (
                                            <tr key={e.id}
                                                className={`border-b border-amber-50 hover:bg-amber-50/60 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-amber-50/20"}`}>
                                                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                                <td className="px-4 py-3 text-slate-700 font-medium">{e.categories?.name ?? "—"}</td>
                                                <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">{formatCurrency(e.amount)}</td>
                                                <td className="px-4 py-3">
                                                    <Badge status={e.status as any} />
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
          SECTION G — Full Expense Detail Table
      ══════════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Expense Detail" />
            <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="border-b border-slate-100 pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-slate-700">All Expenses</p>
                            <p className="text-xs text-slate-400 mt-0.5">{filteredExpenses.length} records</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
                    ) : filteredExpenses.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                            No expenses for this period.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {["Date", "Category", "Amount", "Status", "Receipt"].map((h) => (
                                            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredExpenses.map((e, i) => (
                                        <tr key={e.id}
                                            className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                            <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                            <td className="px-4 py-3 text-slate-700 font-medium">{e.categories?.name ?? "—"}</td>
                                            <td className="px-4 py-3 text-slate-900 font-semibold tabular-nums">{formatCurrency(e.amount)}</td>
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
                    )}
                </CardContent>
            </Card>

        </PageShell>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="p-6 max-w-7xl mx-auto">{children}</div>;
}

function SectionHeading({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-2 mb-3 mt-1">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">{title}</h2>
            <div className="flex-1 h-px bg-slate-100" />
        </div>
    );
}

function StatCard({
    icon, bg, label, value, sub, subColor = "text-slate-400",
}: {
    icon: React.ReactNode; bg: string; label: string; value: string; sub?: string; subColor?: string;
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
            <div className="h-8 w-48 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}</div>
            <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}</div>
            <div className="grid grid-cols-3 gap-4">{[...Array(3)].map((_, i) => <div key={i} className="h-56 bg-slate-100 rounded-xl" />)}</div>
            <div className="grid grid-cols-2 gap-4">{[...Array(2)].map((_, i) => <div key={i} className="h-48 bg-slate-100 rounded-xl" />)}</div>
            <div className="h-64 bg-slate-100 rounded-xl" />
        </div>
    );
}