// hmd-lineup teams/{id}/team_places had: label, address, mapsUrl, count (usage).
// Map to the new Linyup Place shape: label→name, mapsUrl→mapsLink, scope:'team'.
// The legacy `count` usage counter is dropped (stats are out of scope).
export function transformPlace(_id: string, src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    scope: 'team',
    name: String(src.label ?? src.name ?? ''),
  }
  if (typeof src.address === 'string' && src.address) out.address = src.address
  const maps = src.mapsUrl ?? src.mapsLink
  if (typeof maps === 'string' && maps) out.mapsLink = maps
  return out
}
