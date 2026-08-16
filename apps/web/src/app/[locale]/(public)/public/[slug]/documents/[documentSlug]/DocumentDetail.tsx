'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { collectionGroup, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { reportPublicLoadFailure } from '@/lib/publicQueryError'
import { Link } from '@/i18n/navigation'
import type { Route } from 'next'
import { RichTextContent } from '@/components/RichTextEditor'
import { ChevronLeft, ExternalLink, FileText } from 'lucide-react'
import type { DocumentPublicProfile } from '@linyup/shared'
import { usePublicTeam } from '../../PublicTeamProvider'

type LoadState =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'ready'; profile: DocumentPublicProfile }

function usePublicDocument(teamId: string, documentSlug: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(
          query(
            collectionGroup(db, 'public_profile'),
            where('teamId', '==', teamId),
            where('type', '==', 'document'),
            where('slug', '==', documentSlug),
            limit(1),
          ),
        )
        if (cancelled) return
        if (snap.empty) {
          setState({ status: 'notfound' })
          return
        }
        setState({ status: 'ready', profile: snap.docs[0].data() as DocumentPublicProfile })
      } catch (err: unknown) {
        reportPublicLoadFailure('documents/detail', err)
        if (!cancelled) setState({ status: 'notfound' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [teamId, documentSlug])

  return state
}

export function DocumentDetail() {
  const t = useTranslations('Documents')
  const params = useParams()
  const documentSlug = String(params.documentSlug)
  const { slug, teamId, team } = usePublicTeam()
  const state = usePublicDocument(teamId, documentSlug)

  const backLink = (
    <Link
      href={`/public/${slug}/documents` as Route}
      className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
    >
      <ChevronLeft className="h-4 w-4" />
      {t('backToDocuments')}
    </Link>
  )

  if (state.status === 'loading') {
    return (
      <div className="mx-auto max-w-2xl py-8 px-4 space-y-4">
        {backLink}
        <div className="h-8 w-64 rounded bg-muted/40 animate-pulse" />
        <div className="h-40 rounded-lg bg-muted/40 animate-pulse" />
      </div>
    )
  }

  if (state.status === 'notfound') {
    return (
      <div className="mx-auto max-w-2xl py-8 px-4 space-y-4">
        {backLink}
        <div className="rounded-lg border border-dashed py-16 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('documentNotFound')}</p>
        </div>
      </div>
    )
  }

  const { profile } = state

  return (
    <div className="mx-auto max-w-2xl py-8 px-4 space-y-5">
      {backLink}

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{team.name}</p>
        <h1 className="text-2xl font-semibold">{profile.title}</h1>
        {profile.summary && <p className="text-muted-foreground">{profile.summary}</p>}
      </div>

      {profile.source === 'external_link' ? (
        <div className="rounded-lg border bg-card p-6 text-center space-y-4">
          <p className="text-sm text-muted-foreground">{t('externalLinkBody')}</p>
          <a
            href={profile.externalUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('openDocument')}
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-6">
          <RichTextContent html={profile.bodyHtml ?? ''} className="prose-relaxed max-w-none" />
        </div>
      )}
    </div>
  )
}
