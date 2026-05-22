'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getAvailableBalance } from '@/lib/finance/getAvailableBalance'
import { formatCurrency, compactCurrency } from '@/lib/utils/formatCurrency'
import { getCashHealth, CASH_HEALTH_CONFIG } from '@/lib/finance/getCashHealth'
import { getRefillRecommendation } from '@/lib/finance/getRefillRecommendation'
import {
  Wallet, Target, ArrowUpCircle, Clock,
  Store, ShieldAlert, TrendingUp,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import type { User } from '@/types'

// ─── Shared primitives ────────────────────────────────────────────────────────

/** Returns Tailwind text-size class based on value string length.
 *  compactCurrency() ensures most values are ≤8 chars — this adds
 *  visual weight for short values (counts, "—") vs compact amounts. */
function kpiValueSize(value: string): string {
  const n = value.length
  if (n <= 4) return 'text-3xl'   // "5", "12", "—", "None"
  if (n <= 7) return 'text-2xl'   // "₹10.9L", "₹1.2Cr", "₹9,999"
  return 'text-xl'                // "12 days", fallback
}

interface StatCardProps {
  title: string
  value: string
  subtitle?: string
  icon: React.ReactNode
  /** Background colour of the icon container, e.g. "bg-indigo-50" */
  iconBg: string
  /** Optional override for the value text colour */
  valueColor?: string
}

function StatCard({ title, value, subtitle, icon, iconBg, valueColor }: StatCardProps) {
  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      <CardContent className="p-5 lg:p-6 flex flex-col gap-3">
        {/* Label row — icon right-aligned for clean separation */}
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] leading-snug">
            {title}
          </p>
          <div className={`p-2 rounded-xl shrink-0 ${iconBg}`}>{icon}</div>
        </div>
        {/* Value row — never clipped; compactCurrency ensures brevity */}
        <div>
          <p className={`font-bold tabular-nums leading-none ${kpiValueSize(value)} ${valueColor ?? 'text-slate-900'}`}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1.5 font-medium leading-snug">
              {subtitle}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SkeletonCards({ count }: { count: number }) {
  const gridMap: Record<number, string> = {
    3: 'grid-cols-1 sm:grid-cols-3',
    4: 'grid-cols-2 xl:grid-cols-4',
    6: 'grid-cols-2 md:grid-cols-3 2xl:grid-cols-6',
  }
  const gridCls = gridMap[count] ?? 'grid-cols-2 xl:grid-cols-4'
  return (
    <div className={`grid ${gridCls} gap-5 animate-pulse`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[120px] bg-slate-100 rounded-2xl" />
      ))}
    </div>
  )
}

// ─── Cash Health Badge ────────────────────────────────────────────────────────

function CashHealthBadge({ balance, targetFloat }: { balance: number; targetFloat: number }) {
  const health = getCashHealth(balance, targetFloat)
  const cfg = CASH_HEALTH_CONFIG[health]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.color} ${cfg.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// ─── Ledger helper — shared by Cluster and Accounting sections ────────────────
//
// getStoreBalance() makes one Supabase round-trip per store, which is an N+1
// problem for multi-store views. Instead, we fetch all transactions for a set
// of store IDs in a single query and compute per-store balances client-side,
// mirroring the same formula as getStoreBalance().

function computeBalanceMap(
  txns: { store_id: string; type: string; amount: number | string }[]
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const t of txns) {
    const delta =
      t.type === 'credit' || t.type === 'adjustment'
        ? Number(t.amount)
        : -Number(t.amount)
    map[t.store_id] = (map[t.store_id] ?? 0) + delta
  }
  return map
}

// ─── Store Manager ────────────────────────────────────────────────────────────

interface StoreManagerStatsProps {
  user: User
}

function StoreManagerStats({ user }: StoreManagerStatsProps) {
  const supabase = createClient()

  // null = fetch failed; number = confirmed value (0 and negatives are valid)
  const [balance, setBalance] = useState<number | null>(null)        // availableBalance
  const [actualBalance, setActualBalance] = useState<number | null>(null)
  const [reservedAmount, setReservedAmount] = useState(0)
  const [targetFloat, setTargetFloat] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user.store_id) return

    async function load() {
      setLoading(true)
      const [availData, storeRes, expRes] = await Promise.all([
        getAvailableBalance(user.store_id!),
        supabase
          .from('stores')
          .select('monthly_limit')
          .eq('id', user.store_id!)
          .single(),
        supabase
          .from('expenses')
          .select('id')
          .eq('store_id', user.store_id!)
          // submitted = awaiting cluster approval (which is now final)
          .eq('status', 'submitted'),
      ])

      if (availData) {
        setBalance(availData.availableBalance)
        setActualBalance(availData.actualBalance)
        setReservedAmount(availData.reservedAmount)
      } else {
        setBalance(null)
        setActualBalance(null)
        setReservedAmount(0)
      }
      setTargetFloat(storeRes.data?.monthly_limit ?? 0)
      setPendingCount((expRes.data ?? []).length)
      setLoading(false)
    }

    load()
  }, [user.store_id])

  if (loading) return <SkeletonCards count={4} />

  const topUp = balance !== null ? getRefillRecommendation(balance, targetFloat) : null
  const isNegative = balance !== null && balance < 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        {/* 1. Available Balance — availableBalance = actualBalance − reservedAmount */}
        <StatCard
          title="Available Balance"
          value={balance !== null ? compactCurrency(balance) : '—'}
          subtitle={
            isNegative
              ? 'Negative — refill required'
              : reservedAmount > 0
                ? `Reserved: ${compactCurrency(reservedAmount)}`
                : 'No active reservations'
          }
          icon={
            <Wallet
              size={18}
              className={isNegative ? 'text-red-600' : 'text-indigo-600'}
            />
          }
          iconBg={isNegative ? 'bg-red-50' : 'bg-indigo-50'}
          valueColor={isNegative ? 'text-red-600' : undefined}
        />

        {/* 2. Target Float — operational cash goal, not a spending cap */}
        <StatCard
          title="Target Float"
          value={compactCurrency(targetFloat)}
          subtitle="Ideal cash on hand"
          icon={<Target size={18} className="text-slate-500" />}
          iconBg="bg-slate-100"
        />

        {/* 3. Top-Up Needed — how far below the target float we are */}
        <StatCard
          title="Top-Up Needed"
          value={topUp !== null ? compactCurrency(topUp) : '—'}
          subtitle={topUp === 0 ? 'Float is sufficient' : 'Recommended refill'}
          icon={
            <ArrowUpCircle
              size={18}
              className={topUp ? 'text-amber-600' : 'text-emerald-600'}
            />
          }
          iconBg={topUp ? 'bg-amber-50' : 'bg-emerald-50'}
        />

        {/* 4. Pending Approvals — in-flight across all approval stages */}
        <StatCard
          title="Pending Approvals"
          value={String(pendingCount)}
          subtitle="Submitted & in review"
          icon={<Clock size={18} className="text-amber-600" />}
          iconBg="bg-amber-50"
        />
      </div>

      {/* Cash health indicator — only shown once balance is confirmed */}
      {balance !== null && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Cash Health:</span>
          <CashHealthBadge balance={balance} targetFloat={targetFloat} />
        </div>
      )}
    </div>
  )
}

// ─── Cluster Manager ──────────────────────────────────────────────────────────

interface ClusterManagerStatsProps {
  user: User
}

function ClusterManagerStats({ user }: ClusterManagerStatsProps) {
  const supabase = createClient()

  const [storeCount, setStoreCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [storesAtRisk, setStoresAtRisk] = useState(0)
  const [totalRefillNeeded, setTotalRefillNeeded] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user.cluster_id) return

    async function load() {
      setLoading(true)

      const { data: stores } = await supabase
        .from('stores')
        .select('id, monthly_limit')
        .eq('cluster_id', user.cluster_id!)

      if (!stores || stores.length === 0) {
        setLoading(false)
        return
      }

      const storeIds = stores.map((s) => s.id)

      // Single round-trip for all ledger data + pending queue
      const [txRes, expRes] = await Promise.all([
        supabase
          .from('cash_transactions')
          .select('store_id, type, amount')
          .in('store_id', storeIds),
        supabase
          .from('expenses')
          .select('id')
          .in('store_id', storeIds)
          .eq('status', 'submitted'), // only what cluster manager must act on
      ])

      const balanceMap = computeBalanceMap(txRes.data ?? [])

      let atRisk = 0
      let refillTotal = 0

      for (const s of stores) {
        const bal = balanceMap[s.id] ?? 0
        const tf = Number(s.monthly_limit) || 0
        if (getCashHealth(bal, tf) !== 'healthy') atRisk++
        refillTotal += getRefillRecommendation(bal, tf)
      }

      setStoreCount(stores.length)
      setPendingCount((expRes.data ?? []).length)
      setStoresAtRisk(atRisk)
      setTotalRefillNeeded(refillTotal)
      setLoading(false)
    }

    load()
  }, [user.cluster_id])

  if (loading) return <SkeletonCards count={4} />

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Pending approvals — submitted expenses awaiting cluster action */}
      <StatCard
        title="Pending Approvals"
        value={String(pendingCount)}
        subtitle="Awaiting your review"
        icon={<Clock size={18} className="text-amber-600" />}
        iconBg="bg-amber-50"
      />

      {/* 2. Cluster size */}
      <StatCard
        title="Stores in Cluster"
        value={String(storeCount)}
        subtitle="Active locations"
        icon={<Store size={18} className="text-indigo-600" />}
        iconBg="bg-indigo-50"
      />

      {/* 3. Stores at risk — low or negative balance */}
      <StatCard
        title="Stores at Risk"
        value={String(storesAtRisk)}
        subtitle="Low or negative balance"
        icon={
          <ShieldAlert
            size={18}
            className={storesAtRisk > 0 ? 'text-red-600' : 'text-emerald-600'}
          />
        }
        iconBg={storesAtRisk > 0 ? 'bg-red-50' : 'bg-emerald-50'}
        valueColor={storesAtRisk > 0 ? 'text-red-600' : 'text-emerald-700'}
      />

      {/* 4. Total refill needed across all stores in cluster */}
      <StatCard
        title="Refill Required"
        value={compactCurrency(totalRefillNeeded)}
        subtitle="Across all stores"
        icon={
          <ArrowUpCircle
            size={18}
            className={totalRefillNeeded > 0 ? 'text-amber-600' : 'text-emerald-600'}
          />
        }
        iconBg={totalRefillNeeded > 0 ? 'bg-amber-50' : 'bg-emerald-50'}
      />
    </div>
  )
}

// ─── Accounting ───────────────────────────────────────────────────────────────

interface AccountingStatsProps {
  // user is accepted for API consistency even though accounting cards are org-wide
  user: User
}

function AccountingStats({ user: _user }: AccountingStatsProps) {
  const supabase = createClient()

  // null = stores fetch failed; number = confirmed aggregate (may be 0 or negative)
  const [totalBalance, setTotalBalance] = useState<number | null>(null)
  const [totalRefillNeeded, setTotalRefillNeeded] = useState(0)
  const [criticalStores, setCriticalStores] = useState(0)   // negative balance
  const [pendingQueue, setPendingQueue] = useState(0)        // awaiting accounting approval
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)

      const [storeRes, txRes, expRes] = await Promise.all([
        supabase.from('stores').select('id, monthly_limit'),
        supabase.from('cash_transactions').select('store_id, type, amount'),
        supabase
          .from('expenses')
          .select('id')
          // cluster_approved = finalized by cluster, visible to accounting for governance/audit
          .eq('status', 'cluster_approved'),
      ])

      const stores = storeRes.data ?? []
      const balanceMap = computeBalanceMap(txRes.data ?? [])

      let runningBalance = 0
      let refillTotal = 0
      let critical = 0

      for (const s of stores) {
        const bal = balanceMap[s.id] ?? 0
        const tf = Number(s.monthly_limit) || 0
        runningBalance += bal
        refillTotal += getRefillRecommendation(bal, tf)
        if (bal < 0) critical++
      }

      // If the stores query itself errored, keep totalBalance null so the UI
      // shows "—" rather than a misleading ₹0.
      setTotalBalance(storeRes.error ? null : runningBalance)
      setTotalRefillNeeded(refillTotal)
      setCriticalStores(critical)
      setPendingQueue((expRes.data ?? []).length)
      setLoading(false)
    }

    load()
  }, [])

  if (loading) return <SkeletonCards count={4} />

  const balanceNegative = totalBalance !== null && totalBalance < 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Total treasury balance — sum of all store ledger balances */}
      <StatCard
        title="Total Treasury Balance"
        value={totalBalance !== null ? compactCurrency(totalBalance) : '—'}
        subtitle="Across all stores"
        icon={
          <Wallet
            size={18}
            className={balanceNegative ? 'text-red-600' : 'text-indigo-600'}
          />
        }
        iconBg={balanceNegative ? 'bg-red-50' : 'bg-indigo-50'}
        valueColor={balanceNegative ? 'text-red-600' : undefined}
      />

      {/* 2. Total refill requirement to bring all stores to their target floats */}
      <StatCard
        title="Refill Exposure"
        value={compactCurrency(totalRefillNeeded)}
        subtitle="Treasury gap to target"
        icon={
          <ArrowUpCircle
            size={18}
            className={totalRefillNeeded > 0 ? 'text-amber-600' : 'text-emerald-600'}
          />
        }
        iconBg={totalRefillNeeded > 0 ? 'bg-amber-50' : 'bg-emerald-50'}
      />

      {/* 3. Supervisory review queue — cluster-approved, needs accounting record */}
      <StatCard
        title="Supervisory Review"
        value={String(pendingQueue)}
        subtitle="Cluster-approved, needs recording"
        icon={<TrendingUp size={18} className="text-orange-600" />}
        iconBg="bg-orange-50"
        valueColor={pendingQueue > 0 ? 'text-orange-700' : undefined}
      />

      {/* 4. Stores in a negative balance state — most urgent treasury signal */}
      <StatCard
        title="Critical Stores"
        value={String(criticalStores)}
        subtitle="Negative balance"
        icon={
          <ShieldAlert
            size={18}
            className={criticalStores > 0 ? 'text-red-600' : 'text-emerald-600'}
          />
        }
        iconBg={criticalStores > 0 ? 'bg-red-50' : 'bg-emerald-50'}
        valueColor={criticalStores > 0 ? 'text-red-600' : 'text-emerald-700'}
      />
    </div>
  )
}

export { StoreManagerStats, ClusterManagerStats, AccountingStats }
