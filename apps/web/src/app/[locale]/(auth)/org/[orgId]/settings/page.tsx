'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useOrg } from '@/contexts/OrgContext'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Settings } from 'lucide-react'

export default function OrgSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const t = useTranslations('OrgSettings')
  const { org, loading, isAdmin } = useOrg()
  const qc = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Sync form when org loads
  useEffect(() => {
    if (org) {
      setName(org.name)
      setDescription(org.description ?? '')
    }
  }, [org])

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'organizations', orgId), {
        name: name.trim(),
        description: description.trim(),
      })
      qc.invalidateQueries({ queryKey: ['org', orgId] })
      showToast(t('saveSuccess'))
    } catch {
      showToast(t('saveError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">{t('nameLabel')}</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  disabled={!isAdmin}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-description">{t('descriptionLabel')}</Label>
                <Input
                  id="org-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('descriptionPlaceholder')}
                  disabled={!isAdmin}
                />
              </div>
              {isAdmin && (
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving ? '…' : t('saveButton')}
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white z-50 ${
          toast.type === 'error' ? 'bg-destructive' : 'bg-green-600'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
