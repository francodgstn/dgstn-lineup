'use client'

// "Core concepts" area of the How-to page: heading + the clickable concept map
// + a row of five selector cards driving one shared detail panel (body, key
// terms, in-app links). Diagram nodes and cards select the same state — one
// linked system rather than two ways of expanding things.
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Route } from 'next'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { CONCEPTS, type ConceptId } from './concepts'
import { ConceptMap } from './ConceptMap'

export function CoreConcepts() {
  const t = useTranslations('HowTo')
  // Never empty — the panel always shows a concept. Contacts is where both the
  // map (the apex) and the card row start, so it's also where the panel starts.
  const [selected, setSelected] = useState<ConceptId>('contacts')
  const panelRef = useRef<HTMLDivElement>(null)

  // Diagram clicks scroll the panel into view (it may be below the fold);
  // card clicks don't need to — the panel sits right under the row.
  function selectConcept(id: ConceptId, scroll = false) {
    setSelected(id)
    if (scroll) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      )
    }
  }

  const concept = CONCEPTS.find((c) => c.id === selected)!
  // `t.raw` yields the key PATH (a string) when a key is missing, never
  // undefined — so these must be Array.isArray-guarded, not `?? []`, or an
  // absent key renders as a truthy non-array and blows up on .map.
  const raw = (key: string): unknown[] => {
    const v = t.raw(`concepts.${selected}.${key}`)
    return Array.isArray(v) ? v : []
  }
  const terms = raw('terms') as string[]
  // Optional side-by-side block: a concept covering several shapes of the same
  // thing (classes vs appointments vs events) needs them contrasted, not just
  // listed. Data-driven from i18n so the panel stays generic — a concept
  // without `compare` simply doesn't render one.
  const compare = raw('compare') as { title: string; body: string }[]

  return (
    <section>
      <h2 className="text-lg font-semibold">{t('conceptsTitle')}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('conceptsIntro')}</p>

      <div className="mt-6">
        <ConceptMap selected={selected} onSelect={(id) => selectConcept(id, true)} />
      </div>

      {/* Selector card row */}
      <div role="tablist" className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CONCEPTS.map((c) => {
          const active = c.id === selected
          const Icon = c.icon
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`howto-concept-tab-${c.id}`}
              aria-selected={active}
              aria-controls="howto-concept-panel"
              onClick={() => selectConcept(c.id)}
              className={`flex flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left transition-colors ${
                active
                  ? 'border-primary bg-primary/[0.04] ring-1 ring-primary/40'
                  : 'hover:border-muted-foreground/30'
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-md ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">
                  {t(`concepts.${c.id}.label` as Parameters<typeof t>[0])}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {t(`concepts.${c.id}.tagline` as Parameters<typeof t>[0])}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Shared detail panel */}
      <div
        ref={panelRef}
        role="tabpanel"
        id="howto-concept-panel"
        aria-labelledby={`howto-concept-tab-${selected}`}
        className="mt-4 scroll-mt-20 rounded-xl border bg-card p-5"
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t(`concepts.${selected}.body` as Parameters<typeof t>[0])}
        </p>

        {compare.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-muted-foreground">
              {t(`concepts.${selected}.compareIntro` as Parameters<typeof t>[0])}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {compare.map((c, i) => (
                <div key={i} className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-semibold">{c.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {terms.length > 0 && (
          <div className="mt-4">
            <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t('termsLabel')}
            </p>
            <ul className="space-y-1.5">
              {terms.map((term, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                  <span className="shrink-0 text-primary">•</span>
                  <span>{term}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t('seeInApp')}
          </span>
          {concept.links.map((l) => (
            <Link
              key={l.href}
              href={l.href as Route}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t(`concepts.${selected}.links.${l.labelKey}` as Parameters<typeof t>[0])}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
