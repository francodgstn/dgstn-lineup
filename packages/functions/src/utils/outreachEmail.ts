// Ported from hmd-lineup/functions/src/utils/outreachEmail.js
// Variable substitution, HTML body rendering, and outreach email builder for team-defined templates.
import { addDays, format } from 'date-fns'
import { marked } from 'marked'
import { wrapInLayout, gradients, buildTeamFooter } from './emailLayout'
import { getHostingUrl } from './env'

// Re-exported for existing importers — implementation lives in @linyup/shared.
export { buildTeamFooter }

const ACQUISITION_STAGE_LABELS: Record<string, string> = {
  trial_booked: 'Trial booked',
  trial_attended: 'Trial attended',
  joined: 'Joined',
}

const URL_PLACEHOLDER_KEYS = /\{\{(bookingUrl|membershipUrl|bioLinkUrl|websiteUrl|reviewUrl)\}\}/g

// Dotted payload tokens: {{payload.plan}}, {{payload.data.order.id}}.
// Deliberately narrower than the {{\w+}} catch-all below (which cannot match a
// dot), so payload access never collides with team outreach_placeholders.
const PAYLOAD_TOKEN = /\{\{payload((?:\.[\w-]+)+)\}\}/g

type ContactLike = Record<string, unknown>
type TeamDataLike = Record<string, unknown>

/**
 * Walks a dotted path over a plain JSON value. Returns undefined at the first
 * non-object hop, so {{payload.a.b}} on { a: 5 } yields undefined, not a throw.
 *
 * Own properties only: an inherited key would let {{payload.constructor}} reach
 * Object and render its source, so the prototype chain is never followed.
 */
function resolvePath(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Renders a resolved payload value for inclusion in a template. Only scalars
 * render — objects and arrays collapse to '' so a template can never splat a
 * whole webhook body (which may carry the caller's secrets) into an email.
 */
function renderPayloadValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

/**
 * Replaces template placeholder tokens with actual values from contact/team data.
 *
 * @param payload  Trigger-supplied data addressable as {{payload.*}}. For
 *                 inbound_webhook rules this is the raw POST body. Unknown or
 *                 non-scalar paths render as '' — same as an unset {{firstname}}.
 */
export function substituteVariables(
  str: string,
  contact: ContactLike,
  teamName: string,
  now: Date = new Date(),
  teamData: TeamDataLike = {},
  payload?: Record<string, unknown>
): string {
  const baseUrl = getHostingUrl()
  const slug = (teamData.slug as string) || ''
  const socialLinks = (teamData.socialLinks as Array<{ platform: string; url: string }>) || []
  const websiteUrl = socialLinks.find((l) => l.platform === 'website')?.url || ''
  const reviewUrl = socialLinks.find((l) => l.platform === 'review')?.url || ''

  const urlMap: Record<string, string> = {
    bookingUrl: slug ? `${baseUrl}/public/${slug}/booking` : '',
    membershipUrl: slug ? `${baseUrl}/public/${slug}/signup` : '',
    bioLinkUrl: slug ? `${baseUrl}/public/${slug}` : '',
    websiteUrl,
    reviewUrl,
  }

  return (str || '')
    .replaceAll('{{firstname}}', (contact.firstname as string) || '')
    .replaceAll('{{lastname}}', (contact.lastname as string) || '')
    .replaceAll('{{teamName}}', teamName || '')
    .replaceAll(
      '{{acquisition_stage}}',
      ACQUISITION_STAGE_LABELS[(contact.acquisition_stage as string) || ''] ||
        (contact.acquisition_stage as string) ||
        ''
    )
    .replaceAll('{{sessions_count}}', String((contact.total_sessions as number) ?? 0))
    .replace(/\{\{date([+-]\d+)?\}\}/g, (_, offset) => {
      const days = offset ? parseInt(offset, 10) : 0
      return format(addDays(now, days), 'd MMMM yyyy')
    })
    .replace(URL_PLACEHOLDER_KEYS, (_, key) => urlMap[key] || '')
    .replace(PAYLOAD_TOKEN, (_, path: string) =>
      renderPayloadValue(resolvePath(payload, path.slice(1).split('.')))
    )
    .replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const outreachPlaceholders = (teamData.outreach_placeholders as Record<string, string>) || {}
      return outreachPlaceholders[key] !== undefined ? outreachPlaceholders[key] : match
    })
}

/**
 * Renders a template body based on body_mode: 'text' | 'markdown' | 'html'.
 */
export function renderBody(template: { body_mode?: string }, rawBody: string): string {
  if (template.body_mode === 'html') return rawBody
  if (template.body_mode === 'markdown') return marked.parse(rawBody) as string
  // text mode — wrap paragraphs
  return rawBody
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Wraps a rendered body in the full Linyup email layout with team branding.
 */
export function buildOutreachEmail({
  body,
  teamName,
  language,
  teamData,
}: {
  body: string
  teamName: string
  language?: string
  teamData: TeamDataLike
}): { html: string; text: string } {
  const html = wrapInLayout({
    language: language || 'en',
    headerGradient: gradients.primary,
    headerTitle: teamName || 'Linyup',
    content: body,
    footerContent: buildTeamFooter(teamData, language),
  })
  const text = body
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { html, text }
}
