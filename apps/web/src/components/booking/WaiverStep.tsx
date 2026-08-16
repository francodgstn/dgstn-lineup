'use client'

// THE consent step, rendered identically on every public surface that can put a
// person in a room: the booking form, the appointment picker, the waitlist
// claim, the kiosk walk-in and signup — on EVERY terminal submit each of them
// has, not only the ones with a details form.
//
// The census of those files and their submit counts is owned by
// `packages/functions/src/waivers/surfaces.test.ts` (the `SURFACES` table),
// which re-derives it from the sources. Do not restate the per-file counts
// here: this header did, and its number for `BookingForm` disagreed with the
// table that checks it.
//
// ── WHY IT IS A STEP OF ITS OWN, NOT A BLOCK INSIDE "your details" ──────────
// Two of the surfaces book AUTOMATICALLY on verification and never render a
// details form at all — `BookingForm`'s returning-member path and
// `AppointmentPicker`'s `autobooking` screen. A block inside a details form
// would be silently skipped on exactly those paths, and the refusal that
// followed would arrive after the visitor's verification code had already been
// marked used, with re-verification capped per hour. So the step is its own
// screen, interposed immediately before every submit.
//
// ── WHAT IT IS ALLOWED TO SAY ───────────────────────────────────────────────
// One checkbox, the exact frozen text of the version being signed, and — only
// when the studio flagged the waiver "participants may be minors" — one further
// required choice: am I the participant, or am I signing as a parent or
// guardian. Nothing about the studio's plan, nothing about the ledger, and no
// claim about what a signature proves that the record cannot support.
//
// ── THE DECLARATION IS A DECLARATION, AND THE COPY SAYS SO ──────────────────
// Nothing verifies it and nothing can. It does not gate the booking — whichever
// answer the visitor gives, the seat is taken — and its only consequences are
// the two honest ones: it is stored on the acceptance beside the name, and it
// puts a chip on the studio's roster so a human checks at the door. There is no
// default: a preselected radio would answer, on the visitor's behalf, a question
// the record then attributes to them.
//
// ── AT THE CAP ──────────────────────────────────────────────────────────────
// A team may require up to three waivers, each up to 50 000 characters. Built
// for ONE and honest about the rest: additional waivers render as sequential
// sub-steps with a "1 of 3" affordance rather than as three walls of text
// stacked on a phone between "details" and "confirm".

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, FileText, RefreshCw } from 'lucide-react'
import { RichTextContent } from '@/components/RichTextEditor'
import type { WaiverGate } from '@/hooks/useWaiverGate'
import type { WaiverRequirementItem, WaiverSignerChoice } from '@/lib/waiver'

interface Props {
  gate: WaiverGate
  /** The studio's name, for the step's subtitle. */
  teamName: string
  /** Disable every control while the surrounding surface is submitting. */
  disabled?: boolean
}

export function WaiverStep({ gate, teamName, disabled }: Props) {
  const t = useTranslations('Waiver')
  const tCommon = useTranslations('Common')
  const [index, setIndex] = useState(0)

  // ── COULD NOT LOAD ≠ NOTHING REQUIRED ────────────────────────────────────
  // The gate keeps the two apart (`resolved` vs `error`) so its `ready` is
  // false here and the surrounding Confirm is dead. What this screen owes the
  // visitor in exchange is a way OUT: a refusal that is accurate but offers no
  // next step is still a dead end on a booking path, and this one sits between
  // a person and a class they are trying to attend.
  if (gate.error) {
    return (
      <div className="space-y-3 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {/* A throttled READ is not an invalid document, and saying so would send
            a visitor behind a busy studio's NAT away for good. */}
        <p>{gate.error === 'rate_limited' ? t('tooManyAttempts') : t('errorGeneric')}</p>
        <button
          type="button"
          onClick={() => void gate.refresh()}
          disabled={gate.loading || disabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${gate.loading ? 'animate-spin' : ''}`} />
          {tCommon('errorRetry')}
        </button>
      </div>
    )
  }

  if (gate.loading && gate.items.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const items = gate.items
  if (items.length === 0) return null

  const current = items[Math.min(index, items.length - 1)]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">{t('stepTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('stepSubtitle', { team: teamName })}
        </p>
      </div>

      {items.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t('stepCounter', { index: index + 1, total: items.length })}</span>
          <div className="flex gap-1">
            {items.map((item, i) => (
              <button
                key={item.documentId}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={item.title}
                className={`h-1.5 w-6 rounded-full transition-colors ${
                  i === index ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      <WaiverCard gate={gate} item={current} disabled={disabled} />

      {items.length > 1 && index < items.length - 1 && (
        <button
          type="button"
          onClick={() => setIndex(index + 1)}
          className="w-full rounded-xl border py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          {t('stepNext')}
        </button>
      )}
    </div>
  )
}

function WaiverCard({
  gate,
  item,
  disabled,
}: {
  gate: WaiverGate
  item: WaiverRequirementItem
  disabled?: boolean
}) {
  const t = useTranslations('Waiver')

  // ── Already in order ─────────────────────────────────────────────────────
  if (item.action === 'none') {
    return (
      <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-medium">{item.title}</p>
          <p className="text-muted-foreground">{t('alreadySigned')}</p>
        </div>
      </div>
    )
  }

  const choice = gate.choices[item.documentId]

  // ── The ordinary case: read it, tick it ──────────────────────────────────
  return (
    <div className="space-y-3">
      <p className="font-medium">{item.title}</p>

      <div className="max-h-[45vh] overflow-y-auto rounded-xl border bg-card p-4">
        <RichTextContent html={item.bodyHtml} className="prose-relaxed max-w-none text-sm" />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
        <input
          type="checkbox"
          checked={gate.ticks[item.documentId] === true}
          disabled={disabled}
          onChange={(e) => gate.setTick(item.documentId, e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-primary"
        />
        <span className="text-sm">{t('selfConsentLabel', { document: item.title })}</span>
      </label>

      {/* ── Who is ticking. Only when the studio flagged this waiver, and with
          NO preselected option: the answer is stored on the record as the
          visitor's own statement, so it must be one they actually made. */}
      {item.mayIncludeMinors && (
        <fieldset className="space-y-2 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">{t('signerChoiceLabel')}</legend>
          {(['self', 'guardian'] as WaiverSignerChoice[]).map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 text-sm"
              htmlFor={`signer-${value}-${item.documentId}`}
            >
              <input
                id={`signer-${value}-${item.documentId}`}
                type="radio"
                name={`signer-${item.documentId}`}
                value={value}
                checked={choice === value}
                disabled={disabled}
                onChange={() => gate.setChoice(item.documentId, value)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>{value === 'self' ? t('signerChoiceSelf') : t('signerChoiceGuardian')}</span>
            </label>
          ))}

          {choice === 'guardian' && (
            <div className="space-y-1 pt-1">
              <label className="text-sm font-medium" htmlFor={`g-name-${item.documentId}`}>
                {t('guardianNameLabel')}
              </label>
              <input
                id={`g-name-${item.documentId}`}
                type="text"
                value={gate.guardianNames[item.documentId] ?? ''}
                disabled={disabled}
                onChange={(e) => gate.setGuardianName(item.documentId, e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {/* Said where the claim is made, not in a policy page: the studio will
              check at the door, and nothing here proves anything. */}
          <p className="text-xs text-muted-foreground">{t('signerChoiceNote')}</p>
        </fieldset>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {/* What is recorded, said BEFORE the tick rather than after it. */}
        <span>{t('whatIsRecorded')}</span>
      </p>
    </div>
  )
}
