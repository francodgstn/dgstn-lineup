'use client'

// THE PRICE LIST'S ONE HONEST SENTENCE.
//
// A studio whose Connect account cannot be charged still has prices, and until
// now the shop simply vanished (UX-33) — which took away the only public
// surface where a visitor could see what a membership costs. The page stays;
// every control that could take money does not. This block is what replaces
// them: it says the studio is not taking payment online, and it hands the
// visitor the studio's OWN way of being reached.
//
// It invents nothing. Every channel below is something the studio already
// published on its world-readable public_profile — a `mailto:`/`tel:` link it
// put on its own bio-link, the WhatsApp it lists among its socials, the main
// address it chose to show. A studio that published none gets the sentence
// alone: "please get in touch with them directly" is still true, and inventing
// a contact route we do not have would be the one failure worse than silence.

import { Mail, Phone, MessageCircle, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { TeamPublicProfile } from '@linyup/shared'

type ChannelKind = 'email' | 'phone' | 'whatsapp' | 'map'

interface Channel {
  kind: ChannelKind
  href: string
  label: string
}

const ICONS: Record<ChannelKind, React.FC<{ className?: string }>> = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
  map: MapPin,
}

/**
 * The studio's own contact routes, in the order a visitor would try them.
 *
 * `links` is scanned for a `mailto:`/`tel:` URL because that is where a studio
 * actually puts "Email us" / "Call us" — and only among the links it chose to
 * SHOW (`showInBioLink`), so a link it hid stays hidden here too.
 */
export function studioContactChannels(
  team: Pick<TeamPublicProfile, 'links' | 'socialLinks' | 'mainAddress'>,
  label: (kind: ChannelKind) => string
): Channel[] {
  const out: Channel[] = []
  const shown = (team.links ?? []).filter((l) => l.showInBioLink && typeof l.url === 'string')
  const byScheme = (scheme: string) =>
    shown.find((l) => l.url!.trim().toLowerCase().startsWith(scheme))?.url?.trim()

  const email = byScheme('mailto:')
  if (email) out.push({ kind: 'email', href: email, label: label('email') })

  const phone = byScheme('tel:')
  if (phone) out.push({ kind: 'phone', href: phone, label: label('phone') })

  const whatsapp = (team.socialLinks ?? []).find((s) => s.platform === 'whatsapp' && s.url)?.url
  if (whatsapp) out.push({ kind: 'whatsapp', href: whatsapp, label: label('whatsapp') })

  const maps = team.mainAddress?.mapsLink
  if (maps) out.push({ kind: 'map', href: maps, label: label('map') })

  return out
}

export default function PriceListNotice({
  team,
  textMuted,
  textMain,
  accent,
  cardBg,
  cardBorder,
}: {
  team: Pick<TeamPublicProfile, 'links' | 'socialLinks' | 'mainAddress'>
  textMuted: string
  textMain: string
  accent: string
  cardBg: string
  cardBorder: string
}) {
  const t = useTranslations('Shop')
  const channels = studioContactChannels(team, (kind) =>
    kind === 'email'
      ? t('contactEmail')
      : kind === 'phone'
        ? t('contactPhone')
        : kind === 'whatsapp'
          ? t('contactWhatsApp')
          : t('contactDirections')
  )
  // Shown whether or not it is also a "Directions" chip: the address is the
  // answer to "where do I hand them the money", and a line of text says it
  // where a chip only links away.
  const address = team.mainAddress?.address?.trim()

  return (
    <div
      role="note"
      className="mt-6 rounded-2xl border p-4"
      style={{ background: cardBg, borderColor: cardBorder }}
    >
      <p className="text-sm" style={{ color: textMain }}>
        {t('paymentsUnavailable')}
      </p>
      {channels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {channels.map((c) => {
            const Icon = ICONS[c.kind]
            return (
              <a
                key={c.kind}
                href={c.href}
                target={c.kind === 'email' || c.kind === 'phone' ? undefined : '_blank'}
                rel={c.kind === 'email' || c.kind === 'phone' ? undefined : 'noopener noreferrer'}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-75"
                style={{ borderColor: cardBorder, color: accent }}
              >
                <Icon className="h-3.5 w-3.5" />
                {c.label}
              </a>
            )
          })}
        </div>
      )}
      {address && (
        <p className="mt-3 text-xs" style={{ color: textMuted }}>
          {team.mainAddress?.name ? `${team.mainAddress.name} · ` : ''}
          {address}
        </p>
      )}
    </div>
  )
}
