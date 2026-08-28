'use client'

/**
 * THE ORGANISATION'S SETTINGS HUB — the org's answer to `/settings`.
 *
 * It exists because the rail alone was not reachable. The layout renders the
 * rail on rail ROUTES, which is a chicken and egg: standing on Studios or
 * Events there was no rail and no link to any of the seven destinations behind
 * it, so eleven tabs became four rows and seven things that had apparently
 * vanished. A studio never had that problem — `/settings` is a real place you
 * can go, and the rail comes with it.
 *
 * It also settles the phone case the design left open. A rail is a column beside
 * a detail pane on desktop and an INDEX on mobile; an index needs a route of its
 * own to be the index OF. This replaced a disclosure hack in the org layout that
 * existed only because that route did not exist yet.
 *
 * The page itself is deliberately thin: on mobile the rail IS the page (rendered
 * by the layout), and on desktop the rail sits beside this, which says what the
 * section is for rather than duplicating the list next to it.
 */

import { useTranslations } from 'next-intl'

export default function OrgManagePage() {
  const t = useTranslations('Org')

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-semibold">{t('manageTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('manageSubtitle')}</p>
    </div>
  )
}
