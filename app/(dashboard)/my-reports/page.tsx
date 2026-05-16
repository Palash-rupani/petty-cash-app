"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getStoreBalance } from '@/lib/utils/getStoreBalance'
import { getCashHealth } from '@/lib/finance/getCashHealth'
import { getRefillRecommendation } from '@/lib/finance/getRefillRecommendation'
import { computeRunway, getRunwaySeverity } from '@/lib/finance/computeRunway'
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
    TrendingDown,
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
    Target,
    ShieldAlert,
    Timer,
    Banknote,
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
    store?: { monthly_limit: number };
}

interface StoreInfo {
    name: string;
    monthly_limit: number;
}

// Represents a single credit entry from the cash_transactions ledger.
// `note` is the operator's free-text remark; may be null if not recorded.
interface CreditTransaction {
    id: string;
    amount: number;
    created_at: string;
    remarks: string | null;
}

// ─── Status Groups ────────────────────────────────────────────────────────────

const APPROVED_STATUSES = ["accounting_approved", "synced_to_tally"];
const PENDING_STATUSES = ["draft", "submitted", "cluster_approved"];
const REJECTED_STATUSES = ["cluster_rejected", "accounting_rejected", "tally_sync_failed"];
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

// Returns a human-readable relative timestamp for treasury activity rows.
// Keeps recent events short ("Today", "2 days ago") and falls back to the
// full date label for anything older than a week.
function relativeTime(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffMins < 60)  return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 0)  return "Today";
    if (diffDays === 1)  return "Yesterday";
    if (diffDays < 7)   return `${diffDays} days ago`;
    return isoToLabel(dateStr);
}

const PIE_COLORS = { approved: "#22c55e", pending: "#f59e0b", rejected: "#ef4444" };

// ─── Cash Level Gauge ─────────────────────────────────────────────────────────

function CashLevelGauge({ balance, targetFloat }: { balance: number | null; targetFloat: number }) {
    const isValid = balance !== null && targetFloat > 0;
    const rawPct = isValid ? (balance! / targetFloat) * 100 : 0;
    const displayPct = Math.min(Math.max(rawPct, 0), 100);
    const color = rawPct >= 50 ? "#22c55e" : rawPct >= 25 ? "#f59e0b" : "#ef4444";

    return (
        <div className="flex flex-col items-center justify-center h-48">
            <ResponsiveContainer width="100%" height={160}>
                <RadialBarChart
                    cx="50%" cy="80%" innerRadius="60%" outerRadius="100%"
                    startAngle={180} endAngle={0}
                    data={[{ name: "level", value: isValid ? displayPct : 0, fill: isValid ? color : "#e2e8f0" }]}
                    barSize={16}
                >
                    <RadialBar background={{ fill: "#e2e8f0" }} dataKey="value" cornerRadius={8} />
                </RadialBarChart>
            </ResponsiveContainer>
            <div className="flex flex-col items-center -mt-8">
                {!isValid ? (
                    <>
                        <span className="text-2xl font-bold text-slate-400">—</span>
                        <span className="text-xs text-slate-400 mt-0.5">
                            {balance === null ? "Balance unavailable" : "No target float set"}
                        </span>
                    </>
                ) : balance! < 0 ? (
                    <>
                        <span className="text-2xl font-bold text-red-600">—</span>
                        <span className="text-xs text-red-500 mt-0.5">Negative balance</span>
                    </>
                ) : (
                    <>
                        <span className="text-2xl font-bold" style={{ color }}>{displayPct.toFixed(1)}%</span>
                        <span className="text-xs text-slate-500 mt-0.5">of target float</span>
                    </>
                )}
            </div>
        </div>
    );
}

// ─── Liquidity Status Badge ───────────────────────────────────────────────────

function LiquidityBadge({ balance, targetFloat }: { balance: number | null; targetFloat: number }) {
    if (balance === null) {
        return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                Unknown
            </span>
        );
    }
    const health = getCashHealth(balance, targetFloat);
    const config = {
        healthy: { label: "Stable", dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
        low: { label: "Monitor Closely", dot: "bg-amber-500", cls: "bg-amber-50 text-amber-700 border-amber-200" },
        negative: { label: "Urgent Refill Needed", dot: "bg-red-500", cls: "bg-red-50 text-red-700 border-red-200" },
    } as const;
    const { label, dot, cls } = config[health];
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {label}
        </span>
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
    const [balance, setBalance] = useState<number | null>(null);
    // Recent credit transactions — the treasury inflow ledger for this store.
    // Capped at 5; null means the fetch hasn't completed yet.
    const [credits, setCredits] = useState<CreditTransaction[] | null>(null);

    const [timeRange, setTimeRange] = useState<TimeRange>("this_month");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");

    useEffect(() => {
        if (!user?.store_id) return;
        supabase.from("stores").select("name, monthly_limit")
            .eq("id", user.store_id).single()
            .then(({ data, error }) => {
                if (error) setError(error.message); else setStore(data);
            });
    }, [user?.store_id]);

    useEffect(() => {
        async function loadBalance() {
            if (!user?.store_id) return;
            const value = await getStoreBalance(user.store_id);
            setBalance(value);
        }
        loadBalance();
    }, [user, expenses]);

    useEffect(() => {
        if (!user?.store_id) return;
        if (timeRange === "custom" && (!customFrom || !customTo)) return;
        const { from, to } = getDateRange(timeRange, customFrom, customTo);
        setLoading(true);
        supabase.from("expenses")
            .select("id, amount, status, expense_month, created_at, receipt_url, categories(name), store:stores(monthly_limit)")
            .eq("store_id", user.store_id)
            .gte("created_at", from).lte("created_at", to)
            .order("created_at", { ascending: false })
            .then(({ data, error }) => {
                setLoading(false);
                if (error) { setError(error.message); return; }
                const normalised = (data ?? []).map((row) => ({
                    ...row,
                    categories: Array.isArray(row.categories) ? (row.categories[0] ?? null) : row.categories,
                    store: Array.isArray(row.store) ? (row.store[0] ?? null) : row.store,
                })) as Expense[];
                setExpenses(normalised);
            });
    }, [user?.store_id, timeRange, customFrom, customTo]);

    useEffect(() => {
        if (!user?.store_id) return;
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        supabase.from("expenses")
            .select("amount, expense_month, status, created_at")
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

    // ── Fetch recent treasury credits (inflows) ──────────────────────────────
    //
    // One query: latest 5 credit-type ledger entries for this store.
    // This is the financial source of truth for top-up history — not expenses.
    useEffect(() => {
        if (!user?.store_id) return;
        supabase
            .from("cash_transactions")
            .select("id, amount, created_at, remarks")
            .eq("store_id", user.store_id)
            .eq("type", "credit")
            .order("created_at", { ascending: false })
            .limit(5)
            .then(({ data, error }) => {
                if (error) {
                    console.error("Failed to load treasury credits:", error);
                    setCredits([]);
                    return;
                }
                setCredits((data ?? []) as CreditTransaction[]);
            });
    }, [user?.store_id]);

    // ── Derived calculations ─────────────────────────────────────────────────

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

    const targetFloat = store?.monthly_limit ?? 0;

    const avgMonthlyBurn = useMemo(() => {
        const active = trendData.filter((d) => d.amount > 0);
        if (active.length === 0) return 0;
        return active.reduce((s, d) => s + d.amount, 0) / active.length;
    }, [trendData]);

    const activeMonthCount = useMemo(
        () => trendData.filter((d) => d.amount > 0).length,
        [trendData]
    );

    const avgDailyBurn = avgMonthlyBurn / 30.4;

    const runway = useMemo(
        () => computeRunway(balance, avgDailyBurn),
        [balance, avgDailyBurn]
    );
    const runwaySeverity = getRunwaySeverity(runway);

    const pendingExposurePct = useMemo<number | null>(() => {
        if (balance === null || balance <= 0) return null;
        if (totalPending <= 0) return 0;
        return (totalPending / balance) * 100;
    }, [balance, totalPending]);

    const pendingApprovalRows = useMemo(
        () => expenses.filter((e) => IN_REVIEW_STATUSES.includes(e.status)),
        [expenses]
    );

    const agingOver3 = useMemo(() => {
        const threshold = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        return pendingApprovalRows.filter((e) => now - new Date(e.created_at).getTime() > threshold);
    }, [pendingApprovalRows]);

    const agingOver7 = useMemo(() => {
        const threshold = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        return pendingApprovalRows.filter((e) => now - new Date(e.created_at).getTime() > threshold);
    }, [pendingApprovalRows]);

    const treasuryInsights = useMemo(() => {
        type Severity = 'info' | 'warning' | 'critical';
        const insights: { text: string; severity: Severity }[] = [];

        if (balance === null) {
            insights.push({ text: "Balance data is currently unavailable. Cash-sensitive insights are paused.", severity: "warning" });
            return insights;
        }
        if (balance < 0) {
            insights.push({ text: `Balance is ${formatCurrency(Math.abs(balance))} below zero. Immediate top-up required.`, severity: "critical" });
        } else if (targetFloat > 0 && balance < targetFloat * 0.25) {
            const refill = getRefillRecommendation(balance, targetFloat);
            insights.push({ text: `Cash is critically low — below 25% of target float. Refill of ${formatCurrency(refill)} needed.`, severity: "critical" });
        } else if (targetFloat > 0 && balance < targetFloat * 0.5) {
            const refill = getRefillRecommendation(balance, targetFloat);
            insights.push({ text: `Cash is below 50% of target float. Consider topping up ${formatCurrency(refill)} soon.`, severity: "warning" });
        }

        if (pendingExposurePct !== null && pendingExposurePct > 75) {
            insights.push({ text: `Pending approvals total ${formatCurrency(totalPending)}, locking up ${pendingExposurePct.toFixed(0)}% of available cash — high exposure.`, severity: "critical" });
        } else if (pendingExposurePct !== null && pendingExposurePct > 40) {
            insights.push({ text: `Pending approvals represent ${pendingExposurePct.toFixed(0)}% of available cash (${formatCurrency(totalPending)}).`, severity: "warning" });
        }

        if (runway !== null && runway < 7) {
            insights.push({ text: `At current burn rate, runway is ${runway} day${runway !== 1 ? "s" : ""} — refill urgently.`, severity: "critical" });
        } else if (runway !== null && runway < 14) {
            insights.push({ text: `Runway is ${runway} days at current burn rate. Monitor spending closely.`, severity: "warning" });
        }

        if (agingOver7.length > 0) {
            insights.push({ text: `${agingOver7.length} expense${agingOver7.length > 1 ? "s" : ""} pending for more than 7 days — follow-up recommended.`, severity: "warning" });
        } else if (agingOver3.length > 0) {
            insights.push({ text: `${agingOver3.length} expense${agingOver3.length > 1 ? "s" : ""} pending for more than 3 days without action.`, severity: "warning" });
        }

        if (insights.length === 0) {
            insights.push({ text: "Treasury position is stable. No immediate action required.", severity: "info" });
        }
        return insights;
    }, [balance, targetFloat, pendingExposurePct, totalPending, runway, agingOver3, agingOver7]);

    const categoryData = useMemo(() => {
        const map: Record<string, number> = {};
        approved.forEach((e) => { const k = e.categories?.name ?? "Uncategorized"; map[k] = (map[k] ?? 0) + e.amount; });
        return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    }, [approved]);

    const rejectionByCategory = useMemo(() => {
        const map: Record<string, { count: number; total: number }> = {};
        rejected.forEach((e) => {
            const k = e.categories?.name ?? "Uncategorized";
            if (!map[k]) map[k] = { count: 0, total: 0 };
            map[k].count++; map[k].total += e.amount;
        });
        return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
    }, [rejected]);

    const pieData = useMemo(() => [
        { name: "Approved", value: totalApproved, color: PIE_COLORS.approved },
        { name: "Pending", value: totalPending, color: PIE_COLORS.pending },
        { name: "Rejected", value: totalRejected, color: PIE_COLORS.rejected },
    ].filter((d) => d.value > 0), [totalApproved, totalPending, totalRejected]);

    const filteredExpenses = useMemo(() => {
        if (statusFilter === "all") return expenses;
        if (statusFilter === "approved") return approved;
        if (statusFilter === "pending") return pending;
        if (statusFilter === "rejected") return rejected;
        return expenses;
    }, [expenses, statusFilter, approved, pending, rejected]);

    const draftTotal = useMemo(() => drafts.reduce((s, e) => s + e.amount, 0), [drafts]);
    const inReviewTotal = useMemo(() => pendingApprovalRows.reduce((s, e) => s + e.amount, 0), [pendingApprovalRows]);

    const cashLevelPct = pct(balance ?? 0, targetFloat);
    const exposurePctBar = pct(totalPending, balance ?? 0);

    // ── Credit / inflow analytics ────────────────────────────────────────────

    // Most recent credit transaction; null while loading or when none exist.
    const lastTopUp = credits?.[0] ?? null;

    // Average top-up amount across the fetched history (up to 5 entries).
    // Used to flag unusually large injections.
    const avgTopUpAmount = useMemo(() => {
        if (!credits || credits.length === 0) return 0;
        return credits.reduce((s, c) => s + Number(c.amount), 0) / credits.length;
    }, [credits]);

    // ── Guards ───────────────────────────────────────────────────────────────

    if (authLoading) return <PageShell><LoadingState /></PageShell>;
    if (!user || user.role !== "store_manager") {
        return (
            <PageShell>
                <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                    Access restricted to Store Managers.
                </div>
            </PageShell>
        );
    }
    if (error) return <PageShell><p className="text-red-500 p-6 text-sm">{error}</p></PageShell>;

    const currencyFormatter = (value: number | string) =>
        formatCurrency(typeof value === "number" ? value : Number(value));

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <PageShell>

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Store Report</h1>
                {store && (
                    <p className="text-sm text-slate-500 mt-1">
                        {store.name}
                        {targetFloat > 0 && (
                            <span className="text-slate-400"> · Target Float: {formatCurrency(targetFloat)}</span>
                        )}
                    </p>
                )}
            </div>

            {/* ── Filters ────────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3 mb-8 px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                    {(["this_month", "last_3_months", "custom"] as TimeRange[]).map((r) => (
                        <button key={r} onClick={() => setTimeRange(r)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${timeRange === r
                                ? "bg-indigo-600 text-white shadow-sm"
                                : "text-slate-600 hover:text-slate-900"
                                }`}>
                            {r === "this_month" ? "This Month" : r === "last_3_months" ? "Last 3 Months" : "Custom"}
                        </button>
                    ))}
                </div>

                {timeRange === "custom" && (
                    <div className="flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        <span className="text-slate-400 text-sm">to</span>
                        <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                            className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                )}

                <div className="h-5 w-px bg-slate-200 hidden sm:block" />

                <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                    {(["all", "approved", "pending", "rejected"] as StatusFilter[]).map((s) => (
                        <button key={s} onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${statusFilter === s
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-500 hover:text-slate-800"
                                }`}>
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION A — Overview
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Overview" />

            {/*
              Available Cash takes the full first row so it's visually prominent.
              The four secondary KPIs sit below in a uniform 4-col grid —
              same height, same padding, same rhythm as every other KPI row.
            */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                {/* Available Cash — spans 2 cols to carry its visual weight intentionally */}
                <div className="sm:col-span-2 xl:col-span-2">
                    <Card className="h-full rounded-xl border border-slate-200 shadow-sm">
                        <CardContent className="flex flex-col justify-between h-full px-6 py-5">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                    Available Cash
                                </p>
                                {balance !== null ? (
                                    <p className={`text-4xl font-bold tracking-tight tabular-nums ${balance < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                        {formatCurrency(balance)}
                                    </p>
                                ) : (
                                    <p className="text-2xl font-semibold text-slate-400 italic">Unavailable</p>
                                )}
                            </div>
                            <div className="mt-4">
                                <LiquidityBadge balance={balance} targetFloat={targetFloat} />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Target Float */}
                <StatCard
                    icon={<Target className="w-4 h-4 text-slate-500" />}
                    bg="bg-slate-100"
                    label="Target Float"
                    value={targetFloat > 0 ? formatCurrency(targetFloat) : "—"}
                    sub="Ideal cash on hand"
                />

                {/* Total Approved Spend */}
                <StatCard
                    icon={<Wallet className="w-4 h-4 text-indigo-600" />}
                    bg="bg-indigo-50"
                    label="Total Approved Spend"
                    value={formatCurrency(totalApproved)}
                />
            </div>

            {/* Second row: count + largest expense, aligned to same 4-col grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
                <StatCard
                    icon={<Receipt className="w-4 h-4 text-violet-600" />}
                    bg="bg-violet-50"
                    label="Number of Expenses"
                    value={String(expenses.length)}
                />
                <StatCard
                    icon={<ArrowUpCircle className="w-4 h-4 text-amber-600" />}
                    bg="bg-amber-50"
                    label="Largest Expense"
                    value={formatCurrency(largestExpense)}
                />
                {/* Two empty spacer cells keep the row visually balanced on xl */}
                <div className="hidden xl:block" />
                <div className="hidden xl:block" />
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION T — Treasury Intelligence
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Treasury Intelligence" />

            {/* Four intelligence cards — 2×2 on tablet, single row on desktop */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                <StatCard
                    icon={<Timer className="w-4 h-4 text-indigo-600" />}
                    bg="bg-indigo-50"
                    label="Estimated Runway"
                    value={runway !== null ? `${runway} days` : "—"}
                    sub={
                        runway === null
                            ? (avgDailyBurn <= 0 ? "Burn rate unavailable" : "Balance data unavailable")
                            : runway < 7 ? "Refill urgently"
                                : runway < 14 ? "Monitor closely"
                                    : "Cash position healthy"
                    }
                    subColor={
                        runway === null ? "text-slate-400"
                            : runwaySeverity === "critical" ? "text-red-600"
                                : runwaySeverity === "low" ? "text-amber-600"
                                    : "text-emerald-600"
                    }
                />
                <StatCard
                    icon={<TrendingDown className="w-4 h-4 text-orange-500" />}
                    bg="bg-orange-50"
                    label="Avg Monthly Burn"
                    value={avgMonthlyBurn > 0 ? formatCurrency(avgMonthlyBurn) : "—"}
                    sub={
                        activeMonthCount > 0
                            ? `Based on ${activeMonthCount} active month${activeMonthCount > 1 ? "s" : ""}`
                            : "No approved spend history"
                    }
                />
                <StatCard
                    icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
                    bg="bg-amber-50"
                    label="Pending Exposure"
                    value={pendingExposurePct !== null ? `${pendingExposurePct.toFixed(0)}%` : "—"}
                    sub={
                        pendingExposurePct === null
                            ? (balance === null ? "Balance unavailable" : "No pending amounts")
                            : `${formatCurrency(totalPending)} of available cash`
                    }
                    subColor={
                        pendingExposurePct === null ? "text-slate-400"
                            : pendingExposurePct > 75 ? "text-red-600"
                                : pendingExposurePct > 40 ? "text-amber-600"
                                    : "text-slate-400"
                    }
                />

                {/* Last Top-Up — most recent credit from the ledger */}
                <StatCard
                    icon={<Banknote className="w-4 h-4 text-emerald-600" />}
                    bg="bg-emerald-50"
                    label="Last Top-Up"
                    value={
                        credits === null
                            ? "—"
                            : lastTopUp
                                ? formatCurrency(lastTopUp.amount)
                                : "—"
                    }
                    sub={
                        credits === null
                            ? "Loading…"
                            : lastTopUp
                                ? relativeTime(lastTopUp.created_at)
                                : "No treasury refill yet"
                    }
                    subColor={
                        lastTopUp
                            ? "text-emerald-600"
                            : "text-slate-400"
                    }
                />
            </div>

            {/* Approval Aging Alert */}
            {agingOver3.length > 0 && (
                <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-px" />
                    <div className="space-y-0.5">
                        {agingOver7.length > 0 && (
                            <p className="text-sm font-semibold text-amber-800">
                                {agingOver7.length} expense{agingOver7.length > 1 ? "s" : ""} stalled for 7+ days — follow-up needed
                            </p>
                        )}
                        {agingOver3.length > agingOver7.length && (
                            <p className="text-sm text-amber-700">
                                {agingOver3.length - agingOver7.length} expense{agingOver3.length - agingOver7.length > 1 ? "s" : ""} pending for 3–7 days
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Treasury Insights Panel */}
            <Card className="rounded-xl border border-slate-200 shadow-sm mb-8">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
                    <ShieldAlert className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <p className="text-sm font-semibold text-slate-700">Treasury Insights</p>
                </div>
                <div className="px-5 py-4">
                    <ul className="space-y-2">
                        {treasuryInsights.map((insight, i) => (
                            <li key={i} className={`flex items-start gap-3 text-sm px-3.5 py-3 rounded-lg ${insight.severity === "critical" ? "bg-red-50 text-red-800"
                                : insight.severity === "warning" ? "bg-amber-50 text-amber-800"
                                    : "bg-slate-50 text-slate-600"
                                }`}>
                                <span className={`mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full ${insight.severity === "critical" ? "bg-red-500"
                                    : insight.severity === "warning" ? "bg-amber-500"
                                        : "bg-slate-400"
                                    }`} />
                                {insight.text}
                            </li>
                        ))}
                    </ul>
                </div>
            </Card>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION H — Treasury Activity
                Source of truth: cash_transactions WHERE type = 'credit'.
                Read-only visibility — no refill workflow here.
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Treasury Activity" />
            <Card className="rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-slate-700">Recent Top-Ups</p>
                            <p className="text-xs text-slate-400 mt-0.5">Treasury cash inflows — latest 5 credits</p>
                        </div>
                    </div>
                    {credits !== null && credits.length > 0 && (
                        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex-shrink-0">
                            {credits.length} record{credits.length > 1 ? "s" : ""}
                        </span>
                    )}
                </div>

                {credits === null ? (
                    // Skeleton while the credits query is in-flight
                    <div className="px-5 py-6 space-y-3 animate-pulse">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-10 bg-slate-100 rounded-lg" />
                        ))}
                    </div>
                ) : credits.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                        <Banknote className="w-8 h-8 mb-2 text-slate-200" />
                        <p className="text-sm font-medium">No treasury refills recorded yet</p>
                        <p className="text-xs mt-0.5">Credits will appear here once accounting processes a top-up</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    {["Date", "Amount", "Remarks"].map((h) => (
                                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {credits.map((credit, i) => {
                                    // Flag a top-up as unusually large if it's more than 2× the
                                    // average of the fetched batch — a lightweight outlier signal.
                                    const isLarge = avgTopUpAmount > 0 && Number(credit.amount) > avgTopUpAmount * 2;
                                    return (
                                        <tr key={credit.id}
                                            className={`border-b border-slate-50 last:border-0 hover:bg-emerald-50/40 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                            <td className="px-5 py-3.5 whitespace-nowrap">
                                                <span className="text-slate-700 font-medium">{isoToLabel(credit.created_at)}</span>
                                                <span className="ml-2 text-xs text-slate-400">{relativeTime(credit.created_at)}</span>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-emerald-700 tabular-nums">
                                                        {formatCurrency(Number(credit.amount))}
                                                    </span>
                                                    {isLarge && (
                                                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full leading-none">
                                                            Large
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3.5 text-slate-500">
                                                {credit.remarks
                                                    ? <span className="italic">{credit.remarks}</span>
                                                    : <span className="text-slate-300">—</span>
                                                }
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
                SECTION B — Approval Status Summary
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Status Summary" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
                <StatCard
                    icon={<Clock className="w-4 h-4 text-amber-500" />}
                    bg="bg-amber-50"
                    label="Pending Expenses"
                    value={String(pending.length)}
                    sub={`${formatCurrency(totalPending)} held`}
                    subColor="text-amber-600"
                />
                <StatCard
                    icon={<Wallet className="w-4 h-4 text-amber-500" />}
                    bg="bg-amber-50"
                    label="Pending Amount"
                    value={formatCurrency(totalPending)}
                    sub={
                        pendingExposurePct !== null
                            ? `${pendingExposurePct.toFixed(1)}% of available cash`
                            : "Awaiting approval"
                    }
                    subColor="text-amber-600"
                />
                <StatCard
                    icon={<XCircle className="w-4 h-4 text-red-500" />}
                    bg="bg-red-50"
                    label="Rejected Expenses"
                    value={String(rejected.length)}
                    sub={rejected.length > 0 ? `${formatCurrency(totalRejected)} total` : "None this period"}
                    subColor={rejected.length > 0 ? "text-red-500" : "text-slate-400"}
                />
                <StatCard
                    icon={<Wallet className="w-4 h-4 text-red-500" />}
                    bg="bg-red-50"
                    label="Rejected Amount"
                    value={formatCurrency(totalRejected)}
                    sub={rejected.length > 0 ? `Across ${rejected.length} expense${rejected.length > 1 ? "s" : ""}` : undefined}
                    subColor="text-red-500"
                />
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION C — Spend Analytics
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Spend Analytics" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

                {/* Cash Level Gauge */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-1">
                        <p className="text-sm font-semibold text-slate-700">Cash Level</p>
                        <p className="text-xs text-slate-400 mt-0.5">Balance vs. target float</p>
                    </div>
                    <div className="px-5 pb-5">
                        <CashLevelGauge balance={balance} targetFloat={targetFloat} />
                        <div className="flex justify-between text-xs text-slate-400 mb-4">
                            <span>{formatCurrency(0)}</span>
                            <span>{targetFloat > 0 ? formatCurrency(targetFloat) : "No target"}</span>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <div className="flex items-center justify-between text-xs mb-1.5">
                                    <span className="text-slate-500">Cash vs target float</span>
                                    <span className={`font-semibold tabular-nums ${cashLevelPct >= 50 ? "text-emerald-600"
                                        : cashLevelPct >= 25 ? "text-amber-500"
                                            : "text-red-500"
                                        }`}>
                                        {targetFloat > 0 && balance !== null ? `${cashLevelPct.toFixed(1)}%` : "—"}
                                    </span>
                                </div>
                                <ProgressBar
                                    value={cashLevelPct}
                                    color={cashLevelPct >= 50 ? "#22c55e" : cashLevelPct >= 25 ? "#f59e0b" : "#ef4444"}
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between text-xs mb-1.5">
                                    <span className="text-slate-500">Pending commitments</span>
                                    <span className={`font-semibold tabular-nums ${exposurePctBar > 75 ? "text-red-500"
                                        : exposurePctBar > 40 ? "text-amber-500"
                                            : "text-slate-500"
                                        }`}>
                                        {balance !== null && balance > 0 ? `${exposurePctBar.toFixed(1)}%` : "—"}
                                    </span>
                                </div>
                                <ProgressBar value={exposurePctBar} color="#f59e0b" />
                            </div>
                            {balance !== null && balance < 0 && (
                                <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg mt-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-px" />
                                    <span className="text-xs text-red-600 font-medium leading-snug">
                                        Balance is negative — immediate refill required
                                    </span>
                                </div>
                            )}
                            {pendingExposurePct !== null && pendingExposurePct > 75 && balance !== null && balance >= 0 && (
                                <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-lg mt-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-px" />
                                    <span className="text-xs text-amber-700 font-medium leading-snug">
                                        Pending approvals exceed 75% of available cash
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </Card>

                {/* Spend by Category */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Spend by Category</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved expenses only</p>
                    </div>
                    <div className="px-5 pb-5">
                        {categoryData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={categoryData} layout="vertical" barSize={10}
                                    margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }}
                                        width={90} tickLine={false} axisLine={false} />
                                    <Tooltip formatter={currencyFormatter as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                                    <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Card>

                {/* Monthly Trend */}
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-2">
                        <p className="text-sm font-semibold text-slate-700">Monthly Trend</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved spend, last 6 months</p>
                    </div>
                    <div className="px-5 pb-5">
                        {trendData.every((d) => d.amount === 0) ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                                        tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} width={36} />
                                    <Tooltip formatter={currencyFormatter as never}
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
                SECTION D — Approval Funnel + Pie
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Approval Funnel" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-1">
                        <p className="text-sm font-semibold text-slate-700">Expense Pipeline</p>
                        <p className="text-xs text-slate-400 mt-0.5">Breakdown by stage</p>
                    </div>
                    <div className="px-5 pb-2">
                        <FunnelStep label="Draft" count={drafts.length} amount={draftTotal}
                            color="#94a3b8" icon={<Receipt className="w-4 h-4" />} />
                        <FunnelStep label="Submitted / In Review" count={pendingApprovalRows.length}
                            amount={inReviewTotal} color="#f59e0b" icon={<Clock className="w-4 h-4" />} />
                        <FunnelStep label="Approved" count={approved.length} amount={totalApproved}
                            color="#22c55e" icon={<CheckCircle2 className="w-4 h-4" />} />
                        <FunnelStep label="Rejected" count={rejected.length} amount={totalRejected}
                            color="#ef4444" icon={<XCircle className="w-4 h-4" />} />
                    </div>
                </Card>

                <Card className="rounded-xl border border-slate-200 shadow-sm">
                    <div className="px-5 pt-4 pb-1">
                        <p className="text-sm font-semibold text-slate-700">Amount Distribution</p>
                        <p className="text-xs text-slate-400 mt-0.5">Approved vs Pending vs Rejected</p>
                    </div>
                    <div className="px-5 pb-5">
                        {pieData.length === 0 ? <EmptyChart /> : (
                            <ResponsiveContainer width="100%" height={210}>
                                <PieChart>
                                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={54} outerRadius={82}
                                        dataKey="value" paddingAngle={3}>
                                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                    </Pie>
                                    <Tooltip formatter={currencyFormatter as never}
                                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                                    <Legend iconType="circle" iconSize={8}
                                        formatter={(value) => <span className="text-xs text-slate-600">{value}</span>} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Card>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                SECTION E — Rejection Insights (conditional)
            ══════════════════════════════════════════════════════════════════ */}
            {rejected.length > 0 && (
                <>
                    <SectionHeading title="Rejection Insights" />
                    <Card className="rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100">
                            <p className="text-sm font-semibold text-slate-700">Top Rejection Categories</p>
                            <p className="text-xs text-slate-400 mt-0.5">Expenses rejected at any stage</p>
                        </div>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    {["Category", "Rejections", "Rejected Amount"].map((h) => (
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
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                SECTION F — Pending Approval Table (conditional)
            ══════════════════════════════════════════════════════════════════ */}
            {pendingApprovalRows.length > 0 && (
                <>
                    <SectionHeading title="Awaiting Approval" />
                    <Card className="rounded-xl border border-amber-200 shadow-sm mb-8 overflow-hidden" style={{ backgroundColor: "rgba(254,243,199,0.12)" }}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100">
                            <div className="flex items-center gap-2">
                                <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold text-slate-700">Pending Approval</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        Submitted or awaiting cluster sign-off · {formatCurrency(inReviewTotal)} held
                                    </p>
                                </div>
                            </div>
                            <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full flex-shrink-0">
                                {pendingApprovalRows.length} expense{pendingApprovalRows.length > 1 ? "s" : ""}
                            </span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-amber-50/60 border-b border-amber-100">
                                        {["Date", "Category", "Amount", "Status"].map((h) => (
                                            <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingApprovalRows.map((e, i) => (
                                        <tr key={e.id}
                                            className={`border-b border-amber-50 hover:bg-amber-50/50 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-amber-50/20"}`}>
                                            <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                            <td className="px-5 py-3 text-slate-700 font-medium">{e.categories?.name ?? "—"}</td>
                                            <td className="px-5 py-3 font-semibold text-slate-900 tabular-nums">{formatCurrency(e.amount)}</td>
                                            <td className="px-5 py-3"><Badge status={e.status as never} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                SECTION G — Full Expense Detail Table
            ══════════════════════════════════════════════════════════════════ */}
            <SectionHeading title="Expense Detail" />
            <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div>
                        <p className="text-sm font-semibold text-slate-700">All Expenses</p>
                        <p className="text-xs text-slate-400 mt-0.5">{filteredExpenses.length} records</p>
                    </div>
                </div>
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
                                        <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredExpenses.map((e, i) => (
                                    <tr key={e.id}
                                        className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                                        <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{isoToLabel(e.created_at)}</td>
                                        <td className="px-5 py-3 text-slate-700 font-medium">{e.categories?.name ?? "—"}</td>
                                        <td className="px-5 py-3 text-slate-900 font-semibold tabular-nums">{formatCurrency(e.amount)}</td>
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
                )}
            </Card>

        </PageShell>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
    return <div className="px-6 py-8 max-w-7xl mx-auto">{children}</div>;
}

function SectionHeading({ title }: { title: string }) {
    return (
        <div className="flex items-center gap-3 mb-4 mt-2">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">{title}</h2>
            <div className="flex-1 h-px bg-slate-100" />
        </div>
    );
}

function StatCard({
    icon, bg, label, value, sub, subColor = "text-slate-400",
}: {
    icon: React.ReactNode;
    bg: string;
    label: string;
    value: string;
    sub?: string;
    subColor?: string;
}) {
    return (
        <Card className="rounded-xl border border-slate-200 shadow-sm h-full">
            <CardContent className="flex items-start gap-3 px-5 py-5">
                <div className={`p-2 rounded-lg ${bg} flex-shrink-0 mt-0.5`}>{icon}</div>
                <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500 leading-tight">{label}</p>
                    <p className="text-xl font-bold text-slate-900 mt-1 leading-tight tabular-nums">{value}</p>
                    {sub && <p className={`text-xs mt-1 font-medium ${subColor}`}>{sub}</p>}
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
        <div className="space-y-6 animate-pulse">
            <div className="h-8 w-48 bg-slate-100 rounded-lg" />
            <div className="h-12 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="h-28 bg-slate-100 rounded-xl" />
            <div className="grid grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-56 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => <div key={i} className="h-48 bg-slate-100 rounded-xl" />)}
            </div>
            <div className="h-64 bg-slate-100 rounded-xl" />
        </div>
    );
}