'use client'

import { useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { auth } from '@/lib/firebase-client'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  const router = useRouter()
  async function handleSignOut() {
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {})
    await signOut(auth).catch(() => {})
    router.replace('/login')
    router.refresh()
  }
  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut} title="Sign out">
      <LogOut className="size-4" />
      Sign out
    </Button>
  )
}
