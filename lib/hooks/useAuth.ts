'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { User } from '@/types'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    let mounted = true

    const loadUser = async () => {
      try {
        setLoading(true)

        const {
          data: { user: authUser },
        } = await supabase.auth.getUser()

        if (!authUser) {
          if (mounted) {
            setUser(null)
          }
          return
        }

        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single()

        if (mounted) {
          setUser(profile ?? null)
        }
      } catch (err) {
        console.error('Auth load error:', err)

        if (mounted) {
          setUser(null)
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event) => {
      loadUser()
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()

    setUser(null)

    router.replace('/login')
    router.refresh()
  }

  return { user, loading, signOut }
}
