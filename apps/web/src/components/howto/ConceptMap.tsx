'use client'

// The four core concepts as a triangle — Contacts at the apex, Subscriptions →
// Activities → Sessions along the base — hand-rolled inline SVG with clickable,
// keyboard-focusable nodes. Selecting a node selects the matching concept card
// below (one linked system). Themed via Tailwind fill-*/stroke-* utilities so
// class-based dark mode works as-is; scrolls horizontally on narrow screens.
import { useTranslations } from 'next-intl'
import { MAP_NODES, MAP_EDGES, MAP_VIEWBOX, type ConceptId } from './concepts'

interface Props {
  selected: ConceptId
  onSelect: (id: ConceptId) => void
}

export function ConceptMap({ selected, onSelect }: Props) {
  const t = useTranslations('HowTo')

  return (
    <div className="mx-auto max-w-xl">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <svg
          viewBox={MAP_VIEWBOX}
          role="group"
          aria-label={t('diagramAria')}
          className="h-auto w-full min-w-[440px]"
        >
          <defs>
            <marker
              id="howto-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/60" />
            </marker>
          </defs>

          {/* Edges + mid-edge labels. Labels get a background-coloured outline
              (paint-order: stroke) so they stay readable over lines and node
              borders at any translated length. */}
          {MAP_EDGES.map((e) => (
            <g key={e.labelKey}>
              <line
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                strokeWidth={1.5}
                className="stroke-border"
                markerEnd="url(#howto-arrow)"
              />
              <text
                x={e.lx}
                y={e.ly}
                textAnchor="middle"
                fontSize={11}
                strokeWidth={5}
                style={{ paintOrder: 'stroke' }}
                className="fill-muted-foreground stroke-background select-none"
              >
                {t(`edges.${e.labelKey}` as Parameters<typeof t>[0])}
              </text>
            </g>
          ))}

          {/* Nodes — keyboard-focusable buttons. */}
          {MAP_NODES.map((n) => {
            const active = n.id === selected
            return (
              <g
                key={n.id}
                role="button"
                tabIndex={0}
                aria-label={t(`concepts.${n.id}.label` as Parameters<typeof t>[0])}
                aria-pressed={active}
                onClick={() => onSelect(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    onSelect(n.id)
                  }
                }}
                className="cursor-pointer outline-none focus-visible:opacity-80"
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={12}
                  strokeWidth={active ? 1.5 : 1}
                  className={
                    active
                      ? 'fill-primary/10 stroke-primary transition-colors'
                      : 'fill-card stroke-border transition-colors hover:stroke-muted-foreground/60'
                  }
                />
                <text
                  x={n.x + n.w / 2}
                  y={n.y + n.h / 2 + 4.5}
                  textAnchor="middle"
                  fontSize={13}
                  className={`select-none ${active ? 'fill-primary font-semibold' : 'fill-foreground font-medium'}`}
                >
                  {t(`concepts.${n.id}.shortLabel` as Parameters<typeof t>[0])}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <p className="mt-1 text-center text-xs text-muted-foreground sm:hidden">{t('diagramHint')}</p>
    </div>
  )
}
