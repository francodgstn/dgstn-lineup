// Linyup email layout — the single source of truth for outbound email chrome.
// Rebranded to the Linyup violet ramp (landing tokens + Logo.astro mark).
// Lives in @linyup/shared so Cloud Functions (send time) and the web app
// (template editor live preview) render with the exact same layout.
// Pure string-building — keep it dependency-free.

// Brand constants — keep in lockstep with the landing/web violet ramp.
export const BRAND = {
  primary: '#7c3aed', // violet 600 — links, accents, CTA buttons
  primaryDeep: '#5b21b6', // violet 800 — gradient end (logo mark ramp)
  heading: '#4c1d95', // violet 900 — header titles on light ground
  ink: '#2b2438', // violet-biased body text
  muted: '#8b85a0', // footer text
  faint: '#a49dbb', // powered-by line
  page: '#faf9fc', // page ground — one step lighter than the in-card tint
  ground: '#f6f4fa', // violet-tinted in-card panels (header, boxes)
  ring: '#e4e1ec', // 2px card border — matches the dashboard card ring
  hairline: '#e9e5f2',
}

export const gradients = {
  primary: `linear-gradient(135deg, ${BRAND.primary} 0%, ${BRAND.primaryDeep} 100%)`,
  info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  neutral: 'linear-gradient(135deg, #71698a 0%, #4e4763 100%)',
  success: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
  error: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
  warning: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
}

// Card chrome mirrors the dashboard cards (2px ring, 12px radius) — borders
// render reliably in every email client, unlike box-shadow (ignored by Outlook).
// The footer lives OUTSIDE the card: the ring frames the message; the fine
// print (links, unsubscribe, powered-by) recedes onto the page ground below.
const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: ${BRAND.ink}; margin: 0; padding: 0; background-color: ${BRAND.page}; }
  .wrapper { width: 100%; background-color: ${BRAND.page}; padding: 24px 0; }
  .container { max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 2px solid ${BRAND.ring}; }
  .bar { height: 5px; }
  .header { background: ${BRAND.ground}; padding: 28px 24px 22px; text-align: center; border-bottom: 1px solid ${BRAND.hairline}; }
  .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; color: ${BRAND.heading}; }
  .content { padding: 32px 28px; }
  .content p { margin: 0 0 16px 0; }
  .content p:last-child { margin-bottom: 0; }
  .content a { color: ${BRAND.primary}; }
  .footer { max-width: 640px; margin: 14px auto 0; padding: 0 28px; text-align: center; font-size: 12px; color: ${BRAND.muted}; }
  .footer p { margin: 0 0 8px 0; }
  .footer a { color: ${BRAND.primary}; text-decoration: none; }
  @media only screen and (max-width: 680px) { .container { margin: 0 12px; } }
`

/** Builds a bordered details box (used in notification emails). */
export function detailsBox({ title, content, cancelled = false }: { title?: string; content: string; cancelled?: boolean }): string {
  const style = cancelled
    ? `background:${BRAND.ground};padding:20px 24px;border-radius:10px;margin:24px 0;border-left:4px solid #ef4444;opacity:0.85;`
    : `background:${BRAND.ground};padding:20px 24px;border-radius:10px;margin:24px 0;border-left:4px solid ${BRAND.primary};`
  const titleColor = cancelled ? '#dc2626' : BRAND.primaryDeep
  const heading = title
    ? `<h2 style="margin:0 0 16px 0;color:${titleColor};font-size:20px;font-weight:600;">${title}</h2>`
    : ''
  return `<div style="${style}">${heading}${content}</div>`
}

/** Stacked fact lines for a detailsBox (last line without bottom margin). */
export function factLines(facts: string[]): string {
  const kept = facts.filter(Boolean)
  return kept
    .map((f, i) => `<p style="margin:0 0 ${i === kept.length - 1 ? '0' : '6px'} 0;">${f}</p>`)
    .join('\n')
}

/** Brand-violet CTA button (inline-block anchor; wrap in a <p> to position). */
export function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="background:${BRAND.primary};color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">${label}</a>`
}

// Discreet two-tone "liny·up" wordmark line appended to every footer.
const poweredByLine = `<p style="margin-top:12px;color:${BRAND.faint};">Powered by <a href="https://linyup.com" style="text-decoration:none;font-weight:700;"><span style="color:${BRAND.ink};">liny</span><span style="color:${BRAND.primary};">up</span></a></p>`

export function wrapInLayout({
  language = 'en',
  headerGradient = gradients.primary,
  headerIcon,
  headerTitle,
  content,
  footerContent = '',
  poweredBy = true,
}: {
  language?: string
  headerGradient?: string
  headerIcon?: string
  headerTitle: string
  content: string
  footerContent?: string
  poweredBy?: boolean
}): string {
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="bar" style="background: ${headerGradient};"></div>
      <div class="header">
        ${headerIcon ? `<span style="font-size:48px;display:block;margin-bottom:12px;">${headerIcon}</span>` : ''}
        <h1>${headerTitle}</h1>
      </div>
      <div class="content">${content}</div>
    </div>
    <div class="footer">${footerContent}${poweredBy ? poweredByLine : ''}</div>
  </div>
</body>
</html>`
}

/**
 * Builds the team-branded footer for outreach emails (name, links, unsubscribe).
 * Pure — reads only the passed team data. Shared so the web template editor
 * previews the same footer the Cloud Functions send.
 */
export function buildTeamFooter(teamData: Record<string, unknown> = {}, language = 'en'): string {
  const socialLinks = (teamData.socialLinks as Array<{ platform: string; url: string }>) || []
  const settings = (teamData.settings as Record<string, unknown>) || {}
  const links: string[] = []
  const website = socialLinks.find((l) => l.platform === 'website')?.url
  if (website) links.push(`<a href="${website}">Website</a>`)
  if (settings.legalGtcUrl)
    links.push(`<a href="${settings.legalGtcUrl as string}">Terms &amp; Conditions</a>`)
  if (settings.legalPrivacyUrl)
    links.push(`<a href="${settings.legalPrivacyUrl as string}">Privacy Policy</a>`)
  const linkLine = links.length ? `<p>${links.join(' &nbsp;·&nbsp; ')}</p>` : ''
  const teamEmail = (settings.teamEmail as string) || ''
  const emailLine = teamEmail
    ? `<p>${(teamData.name as string) || ''} &nbsp;·&nbsp; ${teamEmail}</p>`
    : teamData.name
      ? `<p>${teamData.name as string}</p>`
      : ''
  const automated = language === 'it' ? 'Messaggio automatico.' : 'Automated message.'
  const unsubLine = teamEmail
    ? `<p>${automated} To unsubscribe, contact us at <a href="mailto:${teamEmail}">${teamEmail}</a> and we will update your preferences.</p>`
    : `<p>${automated} To unsubscribe, reply to this email and we will update your preferences.</p>`
  return emailLine + linkLine + unsubLine
}
