'use client'
import { Landmark } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  ReceiptText,
  CheckSquare,
  BarChart3,
  LogOut,
  Menu,
  X,
  Building2,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useAuth } from '@/lib/hooks/useAuth'
import type { Role } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  roles: Role[]
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: <LayoutDashboard size={18} />,
    roles: ['store_manager', 'cluster_manager', 'accounting'],
  },
  {
    label: 'Expenses',
    href: '/expenses',
    icon: <ReceiptText size={18} />,
    roles: ['store_manager', 'cluster_manager', 'accounting'],
  },
  {
    label: 'My Reports',
    href: '/my-reports',
    icon: <BarChart3 size={18} />,
    roles: ['store_manager'],
  },
  {
    label: 'Approvals',
    href: '/approvals',
    icon: <CheckSquare size={18} />,
    roles: ['cluster_manager', 'accounting'],
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: <BarChart3 size={18} />,
    roles: ['accounting'],
  },
  {
    label: 'Cluster Reports',
    href: '/cluster-reports',
    icon: <BarChart3 size={18} />,
    roles: ['cluster_manager'],
  },
  {
    label: 'Finance Dashboard',
    href: '/accounting-dashboard',
    icon: <BarChart3 size={18} />,
    roles: ['accounting'],
  }, {
    label: 'Cluster Liquidity',
    href: '/cluster-liquidity',
    icon: <Landmark size={18} />,
    roles: ['cluster_manager'],
  },

]

const roleLabels: Record<Role, string> = {
  store_manager: 'Store Manager',
  cluster_manager: 'Cluster Manager',
  accounting: 'Accounting',
}

export function Sidebar() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const visibleItems = navItems.filter(
    (item) => !user?.role || item.roles.includes(user.role as Role)
  )

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-100">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Building2 size={16} className="text-white" />
        </div>
        <div>
          <span className="font-bold text-slate-800 text-base leading-none">VS Corp</span>
          <p className="text-xs text-slate-400 mt-0.5">Petty Cash</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
              )}
            >
              <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      {user && (
        <div className="px-3 py-4 border-t border-slate-100">
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium text-slate-800 truncate">{user.name}</p>
            <p className="text-xs text-slate-400 truncate">{roleLabels[user.role]}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 h-screen sticky top-0 bg-white border-r border-slate-200 flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile toggle button */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md border border-slate-200 text-slate-600"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={cn(
          'md:hidden fixed top-0 left-0 z-40 w-64 h-full bg-white border-r border-slate-200 transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarContent />
      </aside>
    </>
  )
}
