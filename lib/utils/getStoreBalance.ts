import { createClient } from '@/lib/supabase/client'

export async function getStoreBalance(storeId: string) {
    const supabase = createClient()

    console.log('Balance storeId:', storeId)
    const { data, error } = await supabase
        .from('cash_transactions')
        .select('type, amount')
        .eq('store_id', storeId)

    console.log('Transactions:', data)
    console.log('Balance error:', error)

    if (error || !data) {
        return 0
    }

    const balance = data.reduce((total, txn) => {
        if (txn.type === 'credit' || txn.type === 'adjustment') {
            return total + Number(txn.amount)
        }

        if (txn.type === 'debit') {
            return total - Number(txn.amount)
        }

        return total
    }, 0)

    console.log('Calculated balance:', balance)
    return balance
}