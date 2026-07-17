// Abstract wireframe of each public surface, drawn as themed inline SVG rather
// than a screenshot — it can't go stale as the real pages change, needs no
// binary assets, and follows light/dark via Tailwind fill-*/stroke-* utilities.
// Purely decorative (the copy next to it carries the meaning), so the <svg> is
// aria-hidden. Drawn taller than the box it sits in: PublicPages clips the
// bottom so the mock rises out of the card's bottom edge.
import type { PublicPageId } from './concepts'

const VIEWBOX = '0 0 320 260'

type R = React.SVGProps<SVGRectElement>

/** A raised surface (a card, a tile, a row). */
const Card = (p: R) => <rect rx={6} strokeWidth={1} className="fill-card stroke-border" {...p} />
/** Filler standing in for an image or a large empty region. */
const Soft = (p: R) => <rect rx={5} className="fill-muted-foreground/10" {...p} />
/** A line of text. */
const Bar = (p: R) => <rect rx={2.5} className="fill-muted-foreground/25" {...p} />
/** A quieter line of text (secondary copy). */
const Faint = (p: R) => <rect rx={2.5} className="fill-muted-foreground/15" {...p} />
/** A call to action or a selected state. */
const Accent = (p: R) => <rect rx={6} className="fill-primary/25" {...p} />

function BioLink() {
  return (
    <>
      <circle cx={160} cy={46} r={19} className="fill-muted-foreground/20" />
      <Bar x={122} y={76} width={76} height={8} />
      <Faint x={136} y={91} width={48} height={6} />
      {[118, 158, 198, 238].map((y) => (
        <Card key={y} x={52} y={y} width={216} height={30} rx={15} />
      ))}
      <Bar x={120} y={129} width={80} height={7} />
      <Bar x={120} y={169} width={64} height={7} />
      <Bar x={120} y={209} width={72} height={7} />
      <Bar x={120} y={249} width={56} height={7} />
    </>
  )
}

function Website() {
  return (
    <>
      <Bar x={16} y={15} width={54} height={8} />
      {[212, 244, 276].map((x) => (
        <Faint key={x} x={x} y={16} width={28} height={6} />
      ))}
      <Soft x={16} y={36} width={288} height={78} />
      <Bar x={32} y={58} width={132} height={10} />
      <Faint x={32} y={76} width={96} height={6} />
      <Accent x={32} y={90} width={56} height={14} />
      {[16, 117, 218].map((x) => (
        <g key={x}>
          <Card x={x} y={126} width={86} height={66} />
          <Soft x={x + 10} y={136} width={66} height={26} />
          <Bar x={x + 10} y={170} width={52} height={6} />
          <Faint x={x + 10} y={181} width={38} height={5} />
        </g>
      ))}
      <Bar x={16} y={210} width={288} height={8} />
      <Faint x={16} y={228} width={196} height={8} />
      <Faint x={16} y={246} width={240} height={8} />
    </>
  )
}

function Booking() {
  return (
    <>
      <Bar x={16} y={15} width={86} height={8} />
      <Accent x={16} y={34} width={48} height={24} />
      {[72, 128, 184, 240].map((x) => (
        <Card key={x} x={x} y={34} width={48} height={24} />
      ))}
      {[72, 124, 176, 228].map((y) => (
        <g key={y}>
          <Card x={16} y={y} width={288} height={44} />
          <Bar x={30} y={y + 14} width={34} height={7} />
          <Faint x={30} y={y + 26} width={22} height={5} />
          <Bar x={80} y={y + 14} width={98} height={7} />
          <Faint x={80} y={y + 26} width={62} height={5} />
          <Accent x={238} y={y + 12} width={52} height={20} />
        </g>
      ))}
    </>
  )
}

function Shop() {
  return (
    <>
      <Bar x={16} y={15} width={64} height={8} />
      {[
        [16, 38],
        [168, 38],
        [16, 150],
        [168, 150],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <Card x={x} y={y} width={136} height={100} />
          <Soft x={x + 10} y={y + 10} width={116} height={48} />
          <Bar x={x + 10} y={y + 66} width={80} height={7} />
          <Faint x={x + 10} y={y + 79} width={40} height={6} />
          <Accent x={x + 100} y={y + 74} width={26} height={14} />
        </g>
      ))}
    </>
  )
}

function Space() {
  return (
    <>
      <circle cx={32} cy={30} r={14} className="fill-muted-foreground/20" />
      <Bar x={56} y={22} width={72} height={8} />
      <Faint x={56} y={36} width={48} height={6} />
      <Card x={16} y={58} width={288} height={58} />
      <Faint x={30} y={70} width={44} height={6} />
      <Bar x={30} y={84} width={104} height={9} />
      <Accent x={30} y={99} width={58} height={12} />
      <Soft x={236} y={70} width={54} height={34} />
      <Faint x={16} y={130} width={62} height={6} />
      {[144, 190, 236].map((y) => (
        <g key={y}>
          <Card x={16} y={y} width={288} height={38} />
          <Accent x={28} y={y + 10} width={18} height={18} rx={4} />
          <Bar x={56} y={y + 12} width={92} height={7} />
          <Faint x={56} y={y + 24} width={58} height={5} />
        </g>
      ))}
    </>
  )
}

function Appointments() {
  return (
    <>
      <Bar x={16} y={15} width={72} height={8} />
      {[16, 116, 216].map((x, i) => (
        <g key={x}>
          {i === 0 ? (
            <Accent x={x} y={32} width={88} height={38} />
          ) : (
            <Card x={x} y={32} width={88} height={38} />
          )}
          <circle cx={x + 21} cy={51} r={11} className="fill-muted-foreground/25" />
          <Bar x={x + 38} y={44} width={38} height={6} />
          <Faint x={x + 38} y={55} width={26} height={5} />
        </g>
      ))}
      {/* Calendar grid on the left, free times on the right */}
      <Card x={16} y={84} width={188} height={124} />
      {[0, 1, 2, 3, 4, 5, 6].map((c) => (
        <Faint key={c} x={28 + c * 24} y={96} width={14} height={5} />
      ))}
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4, 5, 6].map((c) =>
          r === 1 && c === 3 ? (
            <Accent key={`${r}-${c}`} x={28 + c * 24} y={110 + r * 24} width={18} height={18} rx={4} />
          ) : (
            <Soft key={`${r}-${c}`} x={28 + c * 24} y={110 + r * 24} width={18} height={18} />
          )
        )
      )}
      {[84, 116, 148, 180, 212, 244].map((y, i) => (
        <g key={y}>
          {i === 1 ? (
            <Accent x={216} y={y} width={88} height={24} />
          ) : (
            <Card x={216} y={y} width={88} height={24} />
          )}
          <Bar x={232} y={y + 9} width={40} height={6} />
        </g>
      ))}
    </>
  )
}

function Kiosk() {
  return (
    <>
      <Bar x={16} y={16} width={78} height={12} />
      <Faint x={16} y={34} width={48} height={6} />
      <Soft x={228} y={12} width={76} height={30} />
      {/* Today's schedule */}
      {[56, 106, 156, 206, 256].map((y) => (
        <g key={y}>
          <Card x={16} y={y} width={186} height={42} />
          <Accent x={16} y={y} width={4} height={42} rx={2} />
          <Bar x={32} y={y + 12} width={32} height={7} />
          <Bar x={80} y={y + 12} width={86} height={7} />
          <Faint x={80} y={y + 24} width={54} height={5} />
        </g>
      ))}
      {/* Check-in QR */}
      <Card x={216} y={56} width={88} height={92} />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect
            key={`${r}-${c}`}
            x={232 + c * 14}
            y={70 + r * 14}
            width={10}
            height={10}
            rx={1.5}
            className={(r + c) % 3 === 0 ? 'fill-muted-foreground/15' : 'fill-muted-foreground/40'}
          />
        ))
      )}
      <Faint x={236} y={130} width={48} height={6} />
      <Accent x={216} y={160} width={88} height={28} />
    </>
  )
}

const BODIES: Record<PublicPageId, () => React.ReactElement> = {
  bioLink: BioLink,
  website: Website,
  booking: Booking,
  shop: Shop,
  space: Space,
  appointments: Appointments,
  kiosk: Kiosk,
}

export function PublicPagePreview({ id, className }: { id: PublicPageId; className?: string }) {
  const Body = BODIES[id]
  return (
    <svg viewBox={VIEWBOX} aria-hidden="true" className={className}>
      <rect x={0} y={0} width={320} height={260} className="fill-background" />
      <Body />
    </svg>
  )
}
