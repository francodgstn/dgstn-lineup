'use client'

// Compact "Main Address" card: address text + a keyless Google Maps embed + an
// "open in maps" link. Sourced from the team's primary place. Used in the admin
// Contacts area; the public bio-link renders its own palette-branded variant.

import { MapPin, ExternalLink } from 'lucide-react'

export function MainAddressMap({
  name,
  address,
  mapsLink,
  heading,
  className,
}: {
  name?: string
  address?: string | null
  mapsLink?: string | null
  heading?: string
  className?: string
}) {
  if (!name && !address && !mapsLink) return null
  const query = address || name || ''
  return (
    <div className={className}>
      {heading && <h2 className="mb-2 text-sm font-semibold">{heading}</h2>}
      <div className="overflow-hidden rounded-xl border bg-card">
        {query && (
          <iframe
            title="map"
            className="w-full"
            style={{ minHeight: 180, border: 0 }}
            loading="lazy"
            src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`}
          />
        )}
        <div className="flex items-start gap-2 p-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {name && <p className="text-sm font-medium">{name}</p>}
            {address && <p className="text-xs text-muted-foreground">{address}</p>}
            {mapsLink && (
              <a
                href={mapsLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Open in maps
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
