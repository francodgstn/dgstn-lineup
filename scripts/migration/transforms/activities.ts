function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function transformActivity(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  delete out.is_paid  // not in new schema

  out.slug            = out.slug            ?? slugify(String(src.name ?? ''))
  out.type            = out.type            ?? 'class'
  out.isActive        = out.archived_at     ? false : (out.isActive ?? true)
  // `level` was DROPPED from the schema (replaced by `tags`), so never default or
  // carry one: strip it, but preserve a real source level as a tag rather than
  // losing the information ('all' is not a meaningful tag).
  if (typeof out.level === 'string' && out.level.trim() && out.level !== 'all') {
    const existing = Array.isArray(out.tags) ? (out.tags as unknown[]) : []
    out.tags = [...existing, out.level.trim()]
  }
  delete out.level
  out.alternativeName = out.alternativeName ?? null
  out.base_score      = out.base_score      ?? null

  return out
}
