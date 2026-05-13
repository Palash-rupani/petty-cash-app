'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useAuth } from '@/lib/hooks/useAuth'
import { StoreManagerStats, ClusterManagerStats, AccountingStats } from '@/components/dashboard/StatsCards'
import { RecentExpenses } from '@/components/dashboard/RecentExpenses'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Plus } from 'lucide-react'

export default function DashboardPage() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-slate-100 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!user) return null

  const roleGreetings = {
    store_manager: 'Your Store Overview',
    cluster_manager: 'Cluster Overview',
    accounting: 'System Overview',
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            {roleGreetings[user.role]}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        {user.role === 'store_manager' && (
          <Link href="/expenses/new">
            <Button size="md">
              <Plus size={16} />
              Add Expense
            </Button>
          </Link>
        )}
      </div>

      {/* Role-specific stats */}
      {user.role === 'store_manager' && <StoreManagerStats user={user} />}
      {user.role === 'cluster_manager' && <ClusterManagerStats user={user} />}
      {user.role === 'accounting' && <AccountingStats user={user} />}

      {/* Recent expenses — shown to store managers */}
      {user.role === 'store_manager' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Recent Expenses</h3>
              <Link
                href="/expenses"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <RecentExpenses />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
