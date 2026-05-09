'use client'

import { useState, use, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  doc, getDoc, updateDoc, collection, query, where, orderBy, collectionGroup,
  getDocs, addDoc, deleteDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import {
  CONTACTS_COLLECTION, TEAMS_COLLECTION, SUBSCRIPTION_TYPES_SUBCOLLECTION,
  CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION,
} from '@lineup/shared'
import type {
  Contact, MembershipStatus, ContactType, ContactGender,
  SubscriptionType, SubscriptionHistoryEntry,
} from '@lineup/shared'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft, CalendarDays, Mail, Phone, StickyNote, Star, Flame,
  BookOpen, Award, ChevronDown, ChevronUp, Plus, Trash2, Trophy,
} from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(c: Contact) {
  return `${c.firstname?.[0] ?? ''}${c.lastname?.[0] ?? ''}`.toUpperCase() || '?'
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-red-500', 'bg-indigo-500',
]
function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

const STATUS_VARIANT: Record<MembershipStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  guest: 'secondary', requested: 'outline', under_review: 'outline',
  almost_ready: 'outline', active: 'default', expired: 'destructive',
}

function formatDate(ts: { toDate(): Date } | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], opts ?? { day: '2-digit', month: 'short', year: 'numeric' })
}

function tsToDate(ts: unknown): Date | undefined {
  if (!ts) return undefined
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date) return ts
  if (typeof ts === 'object' && 'toDate' in (ts as object)) return (ts as { toDate(): Date }).toDate()
  return undefined
}

// ─── schema ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  firstname: z.string().min(1).max(60),
  lastname: z.string().min(1).max(60),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().max(30).optional(),
  gender: z.enum(['M', 'F', 'other']).optional(),
  birthdate: z.date().optional(),
  birthplace: z.string().max(100).optional(),
  weight: z.coerce.number().min(0).max(500).optional(),
  type: z.enum(['trial', 'student', 'external']).optional(),
  membership_status: z.enum(['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']).optional(),
  subscription_type_id: z.string().optional(),
  subscription_recurrence: z.string().optional(),
  address_route: z.string().max(100).optional(),
  address_street_number: z.string().max(20).optional(),
  address_postal_code: z.string().max(20).optional(),
  address_locality: z.string().max(100).optional(),
  acquisition_channel: z.string().max(100).optional(),
  acquisition_notes: z.string().max(500).optional(),
})
type ProfileValues = z.infer<typeof profileSchema>

// ─── data hooks ───────────────────────────────────────────────────────────────

function useContact(id: string) {
  return useQuery<Contact | null>({
    queryKey: ['contact', id],
    queryFn: async () => {
      const d = await getDoc(doc(db, CONTACTS_COLLECTION, id))
      if (!d.exists()) return null
      return { id: d.id, ...d.data() } as Contact
    },
  })
}

function useSubscriptionTypes(teamId: string | null) {
  return useQuery<SubscriptionType[]>({
    queryKey: ['subscription-types', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return []
      const snap = await getDocs(
        collection(db, TEAMS_COLLECTION, teamId, SUBSCRIPTION_TYPES_SUBCOLLECTION)
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionType)
    },
  })
}

function useSubscriptionHistory(contactId: string) {
  return useQuery<SubscriptionHistoryEntry[]>({
    queryKey: ['subscription-history', contactId],
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, CONTACTS_COLLECTION, contactId, CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION),
          orderBy('start_date', 'desc'),
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubscriptionHistoryEntry)
    },
  })
}

interface BookingSummary {
  id: string
  sessionId: string
  sessionLabel: string
  sessionStart: { toDate(): Date } | null
  joinedAt: { toDate(): Date } | null
}

function useContactBookings(contactId: string, teamId: string | null) {
  return useQuery<BookingSummary[]>({
    queryKey: ['contact-bookings', contactId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collectionGroup(db, 'bookings'),
          where('teamId', '==', teamId),
          where('contactId', '==', contactId),
          orderBy('joinedAt', 'desc'),
        )
      )
      return snap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          sessionId: d.ref.parent.parent?.id ?? '',
          sessionLabel: data.sessionLabel ?? data.activityName ?? 'Session',
          sessionStart: data.sessionStart ?? null,
          joinedAt: data.joinedAt ?? null,
        }
      })
    },
  })
}

// ─── field wrapper ────────────────────────────────────────────────────────────

function Field({ label, required, children, error }: {
  label: string; required?: boolean; children: React.ReactNode; error?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-1">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ─── profile tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  contact, teamId, onSaved,
}: {
  contact: Contact; teamId: string | null; onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const { data: subTypes = [] } = useSubscriptionTypes(teamId)

  const TYPES: ContactType[] = ['trial', 'student', 'external']
  const STATUSES: MembershipStatus[] = ['guest', 'requested', 'under_review', 'almost_ready', 'active', 'expired']
  const GENDERS: ContactGender[] = ['M', 'F', 'other']

  const RECURRENCES = ['per_class', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual']

  const { register, handleSubmit, control, formState: { errors, isSubmitting, isDirty } } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstname: contact.firstname,
      lastname: contact.lastname,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      gender: contact.gender,
      birthdate: tsToDate(contact.birthdate),
      birthplace: contact.birthplace ?? '',
      weight: contact.weight,
      type: contact.type,
      membership_status: contact.membership_status,
      subscription_type_id: contact.subscription_type_id ?? '',
      subscription_recurrence: contact.subscription_recurrence ?? '',
      address_route: contact.address?.route ?? '',
      address_street_number: contact.address?.street_number ?? '',
      address_postal_code: contact.address?.postal_code ?? '',
      address_locality: contact.address?.locality ?? '',
      acquisition_channel: contact.acquisition?.channel ?? '',
      acquisition_notes: contact.acquisition?.notes ?? '',
    },
  })

  const onSubmit = async (values: ProfileValues) => {
    await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
      firstname: values.firstname,
      lastname: values.lastname,
      email: values.email || null,
      phone: values.phone || null,
      gender: values.gender || null,
      birthdate: values.birthdate ? Timestamp.fromDate(values.birthdate) : null,
      birthplace: values.birthplace || null,
      weight: values.weight || null,
      type: values.type || null,
      membership_status: values.membership_status || 'guest',
      subscription_type_id: values.subscription_type_id || null,
      subscription_recurrence: values.subscription_recurrence || null,
      address: {
        route: values.address_route || null,
        street_number: values.address_street_number || null,
        postal_code: values.address_postal_code || null,
        locality: values.address_locality || null,
      },
      acquisition: {
        channel: values.acquisition_channel || null,
        notes: values.acquisition_notes || null,
        acknowledged: contact.acquisition?.acknowledged ?? false,
      },
      updatedAt: serverTimestamp(),
    })
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 pb-24">
      {/* Contact type */}
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('colType')}</p>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <div className="flex gap-2">
              {TYPES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => field.onChange(v)}
                  className={`flex-1 py-1.5 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    field.value === v
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`type_${v}`)}
                </button>
              ))}
            </div>
          )}
        />
      </div>

      {/* Personal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('fieldFirstname')} required error={errors.firstname?.message}>
          <Input {...register('firstname')} autoCapitalize="words" />
        </Field>
        <Field label={t('fieldLastname')} required error={errors.lastname?.message}>
          <Input {...register('lastname')} autoCapitalize="words" />
        </Field>
        <Field label={t('colEmail')}>
          <Input type="email" {...register('email')} />
        </Field>
        <Field label={t('fieldPhone')}>
          <Input type="tel" {...register('phone')} />
        </Field>

        {/* Gender */}
        <Field label={t('fieldGender')}>
          <Controller
            control={control}
            name="gender"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {GENDERS.map((g) => (
                    <SelectItem key={g} value={g}>{t(`gender_${g}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        {/* Date of birth */}
        <Field label={t('fieldBirthdate')}>
          <Controller
            control={control}
            name="birthdate"
            render={({ field }) => (
              <DatePicker
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </Field>

        <Field label={t('fieldBirthplace')}>
          <Input {...register('birthplace')} />
        </Field>

        <Field label={t('fieldWeight')}>
          <Input type="number" step="0.1" min="0" max="500" {...register('weight')} />
        </Field>
      </div>

      {/* Membership */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('colStatus')}>
          <Controller
            control={control}
            name="membership_status"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(`status_${s}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        {subTypes.length > 0 && (
          <Field label={t('subscriptionTypeName')}>
            <Controller
              control={control}
              name="subscription_type_id"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {subTypes.map((st) => (
                      <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        )}

        <Field label={t('subscriptionRecurrence')}>
          <Controller
            control={control}
            name="subscription_recurrence"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={(val) => field.onChange(val ?? '')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">—</SelectItem>
                  {RECURRENCES.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      {/* Address */}
      <Accordion>
        <AccordionItem value="address">
          <AccordionTrigger className="text-sm font-medium">{t('sectionAddress')}</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <Field label={t('fieldStreet')}>
                <Input {...register('address_route')} />
              </Field>
              <Field label={t('fieldStreetNumber')}>
                <Input {...register('address_street_number')} />
              </Field>
              <Field label={t('fieldPostalCode')}>
                <Input {...register('address_postal_code')} />
              </Field>
              <Field label={t('fieldLocality')}>
                <Input {...register('address_locality')} />
              </Field>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Acquisition */}
      <Accordion>
        <AccordionItem value="acquisition">
          <AccordionTrigger className="text-sm font-medium">{t('sectionAcquisition')}</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 gap-4 pt-2">
              <Field label={t('fieldAcquisitionChannel')}>
                <Input {...register('acquisition_channel')} />
              </Field>
              <Field label={t('fieldAcquisitionNotes')}>
                <Textarea {...register('acquisition_notes')} rows={3} />
              </Field>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Save */}
      {isDirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? tCommon('loading') : t('saveChanges')}
          </button>
        </div>
      )}
    </form>
  )
}

// ─── notes tab ────────────────────────────────────────────────────────────────

function NotesTab({ contact, onSaved }: { contact: Contact; onSaved: () => void }) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [saving, setSaving] = useState(false)
  const isDirty = notes !== (contact.notes ?? '')

  const save = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), {
        notes: notes || null,
        updatedAt: serverTimestamp(),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={12}
        placeholder={t('noNotes')}
        className="resize-none"
      />
      {isDirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? tCommon('loading') : t('saveChanges')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── bookings tab ─────────────────────────────────────────────────────────────

function BookingsTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const { data: bookings = [], isLoading } = useContactBookings(contact.id, teamId)

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )
  if (bookings.length === 0) return (
    <div className="py-12 text-center text-muted-foreground text-sm">{t('noBookings')}</div>
  )
  return (
    <div className="space-y-2">
      {bookings.map((b) => (
        <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg border">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{b.sessionLabel}</p>
            <p className="text-xs text-muted-foreground">
              {b.sessionStart ? formatDate(b.sessionStart) : b.joinedAt ? formatDate(b.joinedAt) : '—'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── subscriptions tab ────────────────────────────────────────────────────────

function SubscriptionsTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const qc = useQueryClient()
  const { data: history = [], isLoading } = useSubscriptionHistory(contact.id)
  const { data: subTypes = [] } = useSubscriptionTypes(teamId)
  const [addOpen, setAddOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['subscription-history', contact.id] })

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:bg-muted transition-colors"
        >
          <Plus className="h-4 w-4" />{t('addSubscription')}
        </button>
      </div>

      {history.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">{t('noSubscriptions')}</div>
      ) : (
        <div className="space-y-2">
          {history.map((entry) => {
            const isActive = !entry.end_date
            const typeName = subTypes.find((s) => s.id === entry.subscription_type_id)?.name
              ?? entry.subscription_type_name ?? '—'
            return (
              <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg border">
                <div className={`h-2 w-2 rounded-full mt-2 shrink-0 ${isActive ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{typeName}</p>
                    {isActive && <Badge variant="default" className="text-xs">{t('subscriptionActiveLabel')}</Badge>}
                  </div>
                  {entry.recurrence && (
                    <p className="text-xs text-muted-foreground">{entry.recurrence.replace('_', ' ')}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatDate(entry.start_date)} – {entry.end_date ? formatDate(entry.end_date) : t('subscriptionEndNone')}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await deleteDoc(doc(db, CONTACTS_COLLECTION, contact.id, CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION, entry.id))
                    invalidate()
                  }}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <AddSubscriptionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        contactId={contact.id}
        subTypes={subTypes}
        onSaved={invalidate}
      />
    </div>
  )
}

function AddSubscriptionDialog({
  open, onOpenChange, contactId, subTypes, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void
  contactId: string; subTypes: SubscriptionType[]; onSaved: () => void
}) {
  const t = useTranslations('Contacts')
  const tCommon = useTranslations('Common')
  const [typeId, setTypeId] = useState('')
  const [recurrence, setRecurrence] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>(new Date())
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [saving, setSaving] = useState(false)

  const RECURRENCES = ['per_class', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual']

  const save = async () => {
    setSaving(true)
    try {
      const typeName = subTypes.find((s) => s.id === typeId)?.name ?? ''
      await addDoc(
        collection(db, CONTACTS_COLLECTION, contactId, CONTACT_SUBSCRIPTION_HISTORY_SUBCOLLECTION),
        {
          subscription_type_id: typeId || null,
          subscription_type_name: typeName || null,
          recurrence: recurrence || null,
          start_date: startDate ? Timestamp.fromDate(startDate) : null,
          end_date: endDate ? Timestamp.fromDate(endDate) : null,
          created_at: serverTimestamp(),
        }
      )
      onSaved()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('addSubscription')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          {subTypes.length > 0 && (
            <Field label={t('subscriptionTypeName')}>
              <Select value={typeId} onValueChange={(v) => setTypeId(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">—</SelectItem>
                  {subTypes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t('subscriptionRecurrence')}>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">—</SelectItem>
                {RECURRENCES.map((r) => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('subscriptionStart')}>
            <DatePicker value={startDate} onChange={setStartDate} />
          </Field>
          <Field label={t('subscriptionEnd')}>
            <DatePicker value={endDate} onChange={setEndDate} placeholder={t('subscriptionEndNone')} />
          </Field>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors">
            {t('cancel')}
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? tCommon('loading') : t('saveChanges')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── gamification tab ─────────────────────────────────────────────────────────

function GamificationTab({ contact, teamId }: { contact: Contact; teamId: string | null }) {
  const t = useTranslations('Contacts')
  const tG = useTranslations('Gamification')
  const qc = useQueryClient()

  // Load coach badges from team settings
  const { data: team } = useQuery({
    queryKey: ['team', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      if (!teamId) return null
      const d = await getDoc(doc(db, 'teams', teamId))
      return d.exists() ? d.data() : null
    },
  })

  const coachBadges: Array<{ key: string; label: string }> =
    team?.settings?.gamification?.coach_badges ?? []

  const assignedBadges: string[] = contact.custom_badges ?? []

  const toggleBadge = async (key: string) => {
    const next = assignedBadges.includes(key)
      ? assignedBadges.filter((b) => b !== key)
      : [...assignedBadges, key]
    await updateDoc(doc(db, CONTACTS_COLLECTION, contact.id), { custom_badges: next })
    qc.invalidateQueries({ queryKey: ['contact', contact.id] })
  }

  return (
    <div className="space-y-6">
      {/* Score summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{contact.current_month_score ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <Star className="h-3 w-3 text-yellow-500" />{tG('sortPoints')}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{contact.current_streak ?? 0}w</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <Flame className="h-3 w-3 text-orange-500" />{tG('sortStreak')}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{contact.total_sessions ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <Trophy className="h-3 w-3 text-primary" />Sessions
          </p>
        </div>
      </div>

      {/* Coach badges */}
      <div>
        <p className="text-sm font-medium mb-3">{tG('coachBadgesSection')}</p>
        {coachBadges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('badgeNone')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {coachBadges.map((badge) => {
              const assigned = assignedBadges.includes(badge.key)
              return (
                <button
                  key={badge.key}
                  onClick={() => toggleBadge(badge.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                    assigned
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Award className="h-3.5 w-3.5" />
                  {badge.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

type TabId = 'profile' | 'notes' | 'bookings' | 'subscriptions' | 'gamification'

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { currentTeamId } = useAuth()
  const { data: contact, isLoading } = useContact(id)
  const [tab, setTab] = useState<TabId>('profile')
  const router = useRouter()
  const t = useTranslations('Contacts')
  const qc = useQueryClient()

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact', id] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!contact) {
    return <div className="py-16 text-center text-muted-foreground">{t('notFound')}</div>
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'profile',       label: t('tabProfile'),       icon: Mail },
    { id: 'notes',         label: t('tabNotes'),         icon: StickyNote },
    { id: 'bookings',      label: t('tabBookings'),      icon: CalendarDays },
    { id: 'subscriptions', label: t('tabSubscriptions'), icon: BookOpen },
    { id: 'gamification',  label: t('tabGamification'),  icon: Star },
  ]

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/contacts')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('title')}
      </button>

      {/* Header card */}
      <div className="rounded-xl border bg-card p-5 flex items-start gap-4">
        <div className={`h-16 w-16 rounded-full shrink-0 flex items-center justify-center text-white text-xl font-bold ${avatarColor(contact.id)}`}>
          {initials(contact)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{contact.firstname} {contact.lastname}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {contact.membership_status && (
              <Badge variant={STATUS_VARIANT[contact.membership_status]}>
                {t(`status_${contact.membership_status}`)}
              </Badge>
            )}
            {contact.type && (
              <Badge variant="outline">{t(`type_${contact.type}`)}</Badge>
            )}
            {!contact.acquisition?.acknowledged && (
              <Badge className="bg-blue-500 text-white border-blue-500">{t('newBadge')}</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {contact.email && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" /> {contact.email}
              </span>
            )}
            {contact.phone && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" /> {contact.phone}
              </span>
            )}
            {contact.created_at && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" /> {t('memberSince')} {formatDate(contact.created_at)}
              </span>
            )}
            {(contact.current_streak ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Flame className="h-3 w-3 text-orange-500" /> {contact.current_streak}w streak
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b overflow-x-auto">
        {TABS.map((tb) => {
          const Icon = tb.icon
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === tb.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tb.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'profile' && (
          <ProfileTab contact={contact} teamId={currentTeamId} onSaved={invalidate} />
        )}
        {tab === 'notes' && (
          <NotesTab contact={contact} onSaved={invalidate} />
        )}
        {tab === 'bookings' && (
          <BookingsTab contact={contact} teamId={currentTeamId} />
        )}
        {tab === 'subscriptions' && (
          <SubscriptionsTab contact={contact} teamId={currentTeamId} />
        )}
        {tab === 'gamification' && (
          <GamificationTab contact={contact} teamId={currentTeamId} />
        )}
      </div>
    </div>
  )
}
