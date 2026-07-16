function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function transformActivity(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...src }

  delete out.is_paid  // not in new schema

  out.slug            = out.slug            ?? slugify(String(src.name ?? ''))
  out.type            = out.type            ?? 'class'
  out.isActive        = out.archived_at     ? false : (out.isActive ?? true)
  out.level           = out.level           ?? 'all'
  out.alternativeName = out.alternativeName ?? null
  out.base_score      = out.base_score      ?? null

  return out
}
