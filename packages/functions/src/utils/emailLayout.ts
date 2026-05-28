// Ported from hmd-lineup/functions/src/utils/email/layout.js
// Shared email layout utilities for consistent styling across all templates.

export const gradients = {
  primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  neutral: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
  error: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
  warning: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
}

const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333333; margin: 0; padding: 0; background-color: #f8f9fa; }
  .wrapper { width: 100%; background-color: #f8f9fa; padding: 20px 0; }
  .container { max-width: 640px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { color: white; padding: 32px 24px; text-align: center; }
  .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
  .content { padding: 32px 28px; }
  .content p { margin: 0 0 16px 0; }
  .content p:last-child { margin-bottom: 0; }
  .footer { background: #f8f9fa; padding: 16px 28px; text-align: center; font-size: 12px; color: #999999; border-top: 1px solid #e0e0e0; }
  .footer p { margin: 0 0 8px 0; }
  .footer a { color: #667eea; text-decoration: none; }
  @media only screen and (max-width: 680px) { .container { margin: 0 12px; } }
`

/** Builds a bordered details box (used in notification emails). */
export function detailsBox({ title, content, cancelled = false }: { title: string; content: string; cancelled?: boolean }): string {
  const style = cancelled
    ? 'background:#f8f9fa;padding:20px 24px;border-radius:8px;margin:24px 0;border-left:4px solid #ef4444;opacity:0.85;'
    : 'background:#f8f9fa;padding:20px 24px;border-radius:8px;margin:24px 0;border-left:4px solid #667eea;'
  const titleColor = cancelled ? '#dc2626' : '#667eea'
  return `<div style="${style}"><h2 style="margin:0 0 16px 0;color:${titleColor};font-size:20px;font-weight:600;">${title}</h2>${content}</div>`
}

export function wrapInLayout({
  language = 'en',
  headerGradient = gradients.primary,
  headerIcon,
  headerTitle,
  content,
  footerContent = '',
}: {
  language?: string
  headerGradient?: string
  headerIcon?: string
  headerTitle: string
  content: string
  footerContent?: string
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
      <div class="header" style="background: ${headerGradient};">
        ${headerIcon ? `<span style="font-size:48px;display:block;margin-bottom:12px;">${headerIcon}</span>` : ''}
        <h1>${headerTitle}</h1>
      </div>
      <div class="content">${content}</div>
      <div class="footer">${footerContent}</div>
    </div>
  </div>
</body>
</html>`
}
