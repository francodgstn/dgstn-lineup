/** Prettify a raw event-type id like 'hmd_fighting_cup' → 'Hmd Fighting Cup'. */
export function prettyEventType(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Resolve a display label for an event type id. Built-in and plugin types have
 * localized `type_<id>` messages in the Events namespace; team-custom types fall
 * back to their configured name, then to a prettified id. `has`/`translate` come
 * from a next-intl `useTranslations('Events')` instance (t.has / t).
 */
export function eventTypeLabel(
  id: string,
  has: (key: string) => boolean,
  translate: (key: string) => string,
  fallbackName?: string,
): string {
  const key = `type_${id}`
  if (has(key)) return translate(key)
  return fallbackName ?? prettyEventType(id)
}
