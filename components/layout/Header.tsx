'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { Bell, LogOut } from 'lucide-react'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/expenses': 'Expenses',
  '/expenses/new': 'New Expense',
  '/approvals': 'Approvals',
  '/reports': 'Reports',
}

export function Header() {
  const pathname = usePathname()
  const { user, signOut } = useAuth()
  const router = useRouter()
  const title = pageTitles[pathname] ?? 'VS Corp'

  const handleSignOut = async () => {
    await signOut()
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between">
      <div className="md:flex-1 pl-10 md:pl-0">
        <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
        <p className="text-xs text-slate-400 hidden md:block">VS Corp Petty Cash Management</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          aria-label="Notifications"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <Bell size={18} />
        </button>
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
              <span className="text-indigo-700 font-semibold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-slate-700 leading-none">{user.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              className="ml-1 p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
