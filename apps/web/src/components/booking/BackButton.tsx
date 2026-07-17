'use client'

// Shared in-content "← Back" affordance for the public booking flows — the
// class BookingForm and the appointment picker. Extracted from BookingForm.tsx
// verbatim (same arrow glyph, text size, spacing); the label is a prop so each
// step can name where Back leads. This is the in-CONTENT back control — distinct
// from BioLinkShell's top-nav team-name link.
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      {label}
    </button>
  )
}
