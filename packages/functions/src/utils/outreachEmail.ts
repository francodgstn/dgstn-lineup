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

type ContactLike = Record<string, unknown>
type TeamDataLike = Record<string, unknown>

/**
 * Replaces template placeholder tokens with actual values from contact/team data.
 */
export function substituteVariables(
  str: string,
  contact: ContactLike,
  teamName: string,
  now: Date = new Date(),
  teamData: TeamDataLike = {}
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
