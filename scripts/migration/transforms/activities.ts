function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function transformActivity(data: Record<string, unknown>): Record<string, unknown> {
  const { is_paid: _is_paid, ...rest } = data as Record<string, unknown> & { is_paid?: unknown }

  return {
    ...rest,
    slug:            data.slug ?? slugify(String(data.name ?? '')),
    type:            data.type ?? 'group_class',
    isActive:        data.isActive ?? !data.archived_at,
    level:           data.level ?? 'all',
    alternativeName: data.alternativeName ?? null,
    base_score:      data.base_score ?? null,
  }
}
