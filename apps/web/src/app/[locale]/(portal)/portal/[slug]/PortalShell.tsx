'use client'

interface PortalShellProps {
  teamName: string
  slug: string
  accentColor?: string | null
  children: React.ReactNode
  wide?: boolean
  stickyBarHeight?: number  // px of bottom padding to reserve for sticky bar
  /** Free-plan portals carry a "Powered by Linyup" footer (public_profile.showBranding). */
  showBranding?: boolean
}

export function PortalShell({ teamName, slug, accentColor, children, wide, stickyBarHeight, showBranding }: PortalShellProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <div className="border-b bg-card px-5 py-3">
        <a
          href={`/portal/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {teamName}
        </a>
      </div>

      {/* Content */}
      <div
        className={`mx-auto px-5 py-8 space-y-6 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        style={stickyBarHeight ? { paddingBottom: `${stickyBarHeight + 32}px` } : undefined}
      >
        {children}
        {showBranding === true && (
          <p className="pt-4 text-center text-[11px] text-muted-foreground">
            Powered by{' '}
            <a href="/" className="hover:underline font-medium">
              Linyup
            </a>
          </p>
        )}
      </div>

      {/* Accent color injected as custom property for CTA buttons */}
      {accentColor && (
        <style>{`:root { --portal-accent: ${accentColor}; }`}</style>
      )}
    </div>
  )
}

/** Primary CTA button styled with the portal's accent color */
export function PortalButton({
  children,
  disabled,
  type = 'button',
  onClick,
  accentColor,
}: {
  children: React.ReactNode
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
  accentColor?: string | null
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
      className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 text-sm"
    >
      {children}
    </button>
  )
}
