'use client'

export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import { ExpenseForm } from '@/components/expenses/ExpenseForm'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ArrowLeft } from 'lucide-react'

export default function NewExpensePage() {
  const router = useRouter()

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="text-slate-500"
        >
          <ArrowLeft size={16} />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-slate-800">New Expense</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Add a new petty cash expense for your store
          </p>
        </CardHeader>
        <CardContent>
          <ExpenseForm onSuccess={() => router.push('/expenses')} />
        </CardContent>
      </Card>
    </div>
  )
}
