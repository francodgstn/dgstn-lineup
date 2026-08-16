'use client'

// "Show me what this person signed" — the operator half of the export.
//
// A studio keeps a waiver for exactly one moment, and that moment arrives years
// later with a lawyer attached. So the artefact is a SINGLE self-contained file:
// every version an acceptance names, its full frozen text, the stored
// fingerprint and an explicit verdict on whether the two still match. A mismatch
// is printed together with what to do about it — an artefact that tells a reader
// the evidence is broken and stops there is worse than one that never checked.
//
// It also carries a second, clearly separated section: every acceptance found
// under the SAME EMAIL ADDRESS but a different contact record. That section is
// mandatory (one human routinely holds several contact ids here, because the
// guest match requires email AND name — a dropped umlaut is enough) and it is
// never merged, because an identity key is sha256(normalised email) and a shared
// family mailbox gives a mother and her child the same one.
//
// The member's own download from Space omits that section, and the SERVER — not
// this component — is what decides which of the two it is producing.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, ShieldCheck } from 'lucide-react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { useWaiverSignersForContact } from '@/hooks/useWaiverStates'

export function ConsentHistoryPanel({
  contactId,
  teamId,
  contactName,
}: {
  contactId: string
  teamId: string | null
  contactName: string
}) {
  const t = useTranslations('Waivers')
  const { rows, active, refetch } = useWaiverSignersForContact(teamId, contactId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  // Which document is mid-revocation, and the typed reason. A destructive action
  // on a compliance record gets a confirmation with a reason field: the reason is
  // stored on the event, and it is the only part of a revocation that explains
  // itself years later.
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  // Offered only where the studio requires something. A team that asks for
  // nothing has collected nothing, and a control that always produces an empty
  // artefact teaches a coach the feature is broken.
  if (!active) return null

  const revoke = async (documentId: string) => {
    setRevokeBusy(true)
    setRevokeError(null)
    try {
      const fn = httpsCallable<
        { documentId: string; contactId: string; reason?: string },
        { revoked: boolean }
      >(functions, 'revokeWaiverAcceptance')
      await fn({ documentId, contactId, reason: revokeReason.trim() || undefined })
      setRevoking(null)
      setRevokeReason('')
      await refetch()
    } catch (err) {
      const reason = (err as { details?: { reason?: string } }).details?.reason
      setRevokeError(
        reason === 'not_signed'
          ? t('errorNotSigned')
          : reason === 'already_revoked'
            ? t('errorAlreadyRevoked')
            : reason === 'ledger_unreadable'
              ? t('errorLedgerUnreadable')
              : t('errorGeneric')
      )
    } finally {
      setRevokeBusy(false)
    }
  }

  const download = async () => {
    setBusy(true)
    setError(false)
    try {
      const fn = httpsCallable<
        { contactId: string; format: 'html' },
        { format: 'html'; html: string }
      >(functions, 'exportContactConsentHistory')
      const res = await fn({ contactId, format: 'html' })
      const blob = new Blob([res.data.html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `consent-history-${contactName.replace(/\s+/g, '-').toLowerCase() || contactId}.html`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t('exportTitle')}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('exportHint')}</p>

      <ul className="mt-3 space-y-2">
        {rows.map(({ entry, signer, state }) => (
          <li key={entry.documentId} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{entry.title}</p>
                <p className="text-xs text-muted-foreground">
                  {signer
                    ? `${t(`state_${state}` as 'state_valid')} · ${t('colVersion')} ${signer.accepted_version} · ${t(`role_${signer.signer_role}` as 'role_self')} · ${signer.accepted_at.toDate().toLocaleDateString()}`
                    : t('state_none')}
                </p>
              </div>
              {/* Offered only where there IS something to withdraw. A revoked row
                  keeps its history and is never revoked twice. */}
              {signer && signer.status !== 'revoked' && (
                <button
                  type="button"
                  onClick={() => {
                    setRevoking(entry.documentId)
                    setRevokeReason('')
                    setRevokeError(null)
                  }}
                  className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                >
                  {t('revokeAction')}
                </button>
              )}
            </div>

            {revoking === entry.documentId && (
              <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium">{t('revokeConfirmTitle')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('revokeConfirmBody')}</p>
                <label className="mt-2 block text-xs font-medium" htmlFor="waiver-revoke-reason">
                  {t('revokeReasonLabel')}
                </label>
                <input
                  id="waiver-revoke-reason"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void revoke(entry.documentId)}
                    disabled={revokeBusy}
                    className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50"
                  >
                    {revokeBusy ? t('revoking') : t('revokeConfirmAction')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevoking(null)}
                    disabled={revokeBusy}
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                  >
                    {t('revokeCancel')}
                  </button>
                </div>
                {revokeError && <p className="mt-2 text-sm text-destructive">{revokeError}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {busy ? t('exportPreparing') : t('exportAction')}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{t('exportError')}</p>}
    </div>
  )
}
