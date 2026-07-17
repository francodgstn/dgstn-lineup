'use client'

// Body of the feedback sheet: the general feedback form (likert + free text +
// scope chips + optional native-tab screenshot) and the ops-pushed prompt
// questions (answer inline, mute, unmute). Page context is always attached
// automatically. Submissions are direct Firestore creates validated by rules;
// the ops email notification is sent by the onFeedbackCreated trigger.

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { toast } from 'sonner'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { usePlan } from '@/hooks/usePlan'
import { usePathname } from '@/i18n/navigation'
import {
  captureTabScreenshot,
  isScreenshotSupported,
  markPromptAnswered,
  mutePrompt,
  unmutePrompt,
} from '@/lib/feedback'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  BellOff,
  Camera,
  Check,
  CheckCircle2,
  Loader2,
  MessageSquareHeart,
  X,
} from 'lucide-react'
import {
  FEEDBACK_COLLECTION,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_SCOPES,
  type FeedbackScope,
  type FeedbackType,
} from '@linyup/shared'
import type { ActivePrompt, PromptBuckets } from './hooks'

const RATING_FACES = ['😞', '😕', '😐', '🙂', '😍'] as const

interface SubmitVars {
  type: FeedbackType
  rating: number | null
  message: string
  scopes: FeedbackScope[]
  promptId?: string
  screenshot?: Blob | null
}

export function FeedbackPanel({
  buckets,
  onClose,
}: {
  buckets: PromptBuckets
  onClose: () => void
}) {
  const t = useTranslations('Feedback')
  const locale = useLocale()
  const pathname = usePathname()
  const { user, team } = useAuth()
  const { plan } = usePlan()

  const submit = useMutation({
    mutationFn: async (vars: SubmitVars) => {
      if (!user?.uid || !user.email || !team) throw new Error('not-ready')

      let screenshotPath: string | null = null
      if (vars.screenshot) {
        screenshotPath = `feedback/${user.uid}/${crypto.randomUUID()}.png`
        await uploadBytes(storageRef(storage, screenshotPath), vars.screenshot, {
          contentType: 'image/png',
        })
      }

      // Build conditionally: rules use keys().hasOnly and Firestore rejects
      // `undefined`, so optional keys must be absent, not undefined.
      await addDoc(collection(db, FEEDBACK_COLLECTION), {
        type: vars.type,
        ...(vars.rating ? { rating: vars.rating } : {}),
        ...(vars.message.trim() ? { message: vars.message.trim() } : {}),
        scopes: vars.scopes,
        ...(vars.promptId ? { prompt_id: vars.promptId } : {}),
        context: {
          path: pathname,
          title: typeof document !== 'undefined' ? document.title : '',
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          user_agent: navigator.userAgent,
          locale,
        },
        team_id: team.id,
        team_name: team.name ?? '',
        plan: plan ?? '',
        created_by: user.uid,
        created_by_email: user.email,
        created_at: serverTimestamp(),
        ...(screenshotPath ? { screenshot_path: screenshotPath } : {}),
        status: 'new',
      })

      if (vars.promptId) await markPromptAnswered(user.uid, vars.promptId)
    },
    onError: () => toast.error(t('sendError')),
  })

  return (
    <>
      <SheetHeader className="border-b px-4 py-3">
        <SheetTitle className="flex items-center gap-2">
          <MessageSquareHeart className="h-4 w-4 text-primary" />
          {t('title')}
        </SheetTitle>
        <SheetDescription className="text-xs">{t('subtitle')}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {buckets.open.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('questionsTitle')}
            </h3>
            {buckets.open.map((p) => (
              <PromptCard key={p.id} prompt={p} submit={submit} uid={user?.uid} />
            ))}
          </section>
        )}

        <GeneralForm submit={submit} onDone={onClose} />

        {(buckets.answered.length > 0 || buckets.muted.length > 0) && (
          <section className="space-y-2 border-t pt-4">
            {buckets.answered.map((p) => (
              <div key={p.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  {p.question}
                  <span className="ml-1.5 text-xs">({t('answered')})</span>
                </span>
              </div>
            ))}
            {buckets.muted.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('mutedTitle')}
                </h4>
                {buckets.muted.map((p) => (
                  <div key={p.id} className="flex items-start justify-between gap-2 text-sm text-muted-foreground">
                    <span className="flex items-start gap-2">
                      <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
                      {p.question}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => user?.uid && unmutePrompt(user.uid, p.id)}
                    >
                      {t('unmute')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}

/** 1–5 likert row (click again to clear). */
function RatingRow({
  value,
  onChange,
  size = 'md',
}: {
  value: number | null
  onChange: (v: number | null) => void
  size?: 'md' | 'sm'
}) {
  const t = useTranslations('Feedback')
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={t('ratingLabel')}>
      {RATING_FACES.map((face, i) => {
        const v = i + 1
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            aria-label={`${v}/5`}
            onClick={() => onChange(active ? null : v)}
            className={`flex items-center justify-center rounded-full border transition-all ${
              size === 'md' ? 'h-10 w-10 text-xl' : 'h-8 w-8 text-base'
            } ${
              active
                ? 'scale-110 border-primary bg-primary/10'
                : 'border-transparent opacity-60 grayscale hover:opacity-100 hover:grayscale-0'
            }`}
          >
            {face}
          </button>
        )
      })}
    </div>
  )
}

type SubmitMutation = UseMutationResult<void, Error, SubmitVars>

function GeneralForm({ submit, onDone }: { submit: SubmitMutation; onDone: () => void }) {
  const t = useTranslations('Feedback')
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [scopes, setScopes] = useState<FeedbackScope[]>([])
  const [screenshot, setScreenshot] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)

  const previewRef = useRef<string | null>(null)
  useEffect(() => {
    previewRef.current = previewUrl
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [previewUrl])

  function setShot(blob: Blob | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setScreenshot(blob)
    setPreviewUrl(blob ? URL.createObjectURL(blob) : null)
  }

  async function capture() {
    setCapturing(true)
    // Hide the sheet (content + backdrop) so the captured frame shows the page
    // underneath, not the feedback panel itself.
    const hidden = document.querySelectorAll<HTMLElement>(
      '[data-slot="sheet-content"], [data-slot="sheet-overlay"]'
    )
    hidden.forEach((el) => (el.style.visibility = 'hidden'))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const blob = await captureTabScreenshot()
      if (blob) setShot(blob)
    } finally {
      hidden.forEach((el) => (el.style.visibility = ''))
      setCapturing(false)
    }
  }

  const canSubmit = (rating !== null || message.trim().length > 0) && !submit.isPending

  function toggleScope(s: FeedbackScope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  function handleSubmit() {
    submit.mutate(
      { type: 'general', rating, message, scopes, screenshot },
      {
        onSuccess: () => {
          toast.success(t('sent'))
          setRating(null)
          setMessage('')
          setScopes([])
          setShot(null)
          onDone()
        },
      }
    )
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('ratingLabel')}</p>
        <RatingRow value={rating} onChange={setRating} />
      </div>

      <div className="space-y-1.5">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('messagePlaceholder')}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          rows={4}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('scopesLabel')}</p>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_SCOPES.map((s) => {
            const active = scopes.includes(s)
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => toggleScope(s)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {t(`scopes.${s}`)}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('scopesHint')}</p>
      </div>

      {isScreenshotSupported() && (
        <div className="space-y-1.5">
          {previewUrl ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt={t('screenshotAlt')}
                className="max-h-32 rounded-md border object-contain"
              />
              <button
                type="button"
                aria-label={t('screenshotRemove')}
                onClick={() => setShot(null)}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={capture}
              disabled={capturing}
            >
              {capturing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {t('screenshotAdd')}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t('screenshotHint')}</p>
        </div>
      )}

      <Button type="button" className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
        {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {t('submit')}
      </Button>
    </section>
  )
}

function PromptCard({
  prompt,
  submit,
  uid,
}: {
  prompt: ActivePrompt
  submit: SubmitMutation
  uid: string | undefined
}) {
  const t = useTranslations('Feedback')
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [muting, setMuting] = useState(false)

  const canAnswer =
    ((prompt.allow_rating && rating !== null) ||
      (prompt.allow_text && message.trim().length > 0)) &&
    !submit.isPending

  function answer() {
    submit.mutate(
      {
        type: 'prompt_answer',
        rating: prompt.allow_rating ? rating : null,
        message: prompt.allow_text ? message : '',
        scopes: [],
        promptId: prompt.id,
      },
      { onSuccess: () => toast.success(t('answerSent')) }
    )
  }

  async function mute() {
    if (!uid) return
    setMuting(true)
    try {
      await mutePrompt(uid, prompt.id)
    } finally {
      setMuting(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{prompt.question}</p>
          {prompt.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{prompt.description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('mute')}
          title={t('mute')}
          disabled={muting}
          onClick={mute}
          className="shrink-0 text-muted-foreground"
        >
          <BellOff className="h-4 w-4" />
        </Button>
      </div>
      {prompt.allow_rating && <RatingRow value={rating} onChange={setRating} size="sm" />}
      {prompt.allow_text && (
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('answerPlaceholder')}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          rows={2}
        />
      )}
      <Button type="button" size="sm" disabled={!canAnswer} onClick={answer}>
        {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {t('answer')}
      </Button>
    </div>
  )
}
