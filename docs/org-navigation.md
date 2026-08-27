# Organisation navigation — design

**Status: designed, not built.** Decisions taken 2026-08-25 (Franco). Recorded
before implementation so the shape is agreed rather than discovered halfway.

---

## What is wrong today

`app/[locale]/(auth)/org/[orgId]/layout.tsx` renders **eleven** destinations in
one horizontal strip:

```tsx
<nav className="flex gap-0.5 border-b">
```

No `flex-wrap`, no `overflow-x-auto`. Eleven icon+label tabs run to roughly
1100–1400px; a 1280 viewport minus the sidebar leaves about 1000. So it overflows
on an ordinary laptop and is unusable on a phone — in an app whose own porting
guidance is mobile-first.

The overflow is the visible failure. The structural one is that this is a **third
navigation paradigm**. The app already has two, both considered:

- **Sidebar sections** (`NAV_SECTIONS`: Run / Offer / Grow) for the surfaces a
  studio opens during a working day, ordered by frequency of use rather than
  alphabetically — see the long note above `NAV_SECTIONS`.
- **The settings rail** (`components/settings/SettingsRail.tsx`) for many related
  configuration destinations: grouped, searchable, a rail beside the detail pane
  on desktop and the index list itself on mobile.

The org area used neither. And its eleven tabs — Studios, Events, Program
templates, Affiliations, Ranking, Places, Website, Plugins, Members, Billing,
Settings — are not a feature area. That is an entire application's navigation
compressed into a tab strip.

## The decisions

**1. An organisation is a SCOPE you switch into, not a section beside the team.**

Nearly every org concept collides by name with a team one: Events, Places,
Website, Plugins, Members and Settings all exist at both levels. Two sidebar rows
called "Events" never stop being ambiguous, whatever they are labelled; one
unmistakable scope indicator resolves it once.

The cost is a click when moving between HMD and Basel — which the org admin who
also runs a studio will do often — so the switcher must be fast and the current
scope must be impossible to mistake.

**2. The org gets the same SHAPE a team has: a few sidebar rows, and a settings
rail for everything configurational.**

Most of those eleven destinations are opened occasionally, not during a working
day. Treating "today's events" and "billing" as equals in one flat list is what
made the strip eleven long in the first place.

## The information architecture

**Org sidebar rows** — opened while doing the organisation's work:

| Row | Today |
|---|---|
| Studios | `/org/{id}/teams` — rename to match the product's own vocabulary (`plan: 'studio'`, "studio" throughout CLAUDE.md) |
| Events | `/org/{id}/events` |
| Program templates | `/org/{id}/program-templates` — sits by Events because it is read while creating one |
| Website | `/org/{id}/website` — authoring, exactly as the team's website is a sidebar row |

**Org settings rail** — grouped, reusing `SettingsRail`'s pattern:

| Group | Items |
|---|---|
| Standards the org sets | Ranking systems, Affiliations |
| Shared resources | Places |
| Administration | Members, Plugins, Billing, Settings |

The grouping is not cosmetic: the first group is what an organisation imposes on
its member studios (and is exactly what `Organization.ranking_systems` and the
org affiliation types already override downward), the second is what it lends
them, the third is about the organisation itself.

## What this reuses

The point of the design is that almost nothing is new:

- the sidebar shell, its section rendering, collapse mode, and mobile drawer;
- `SettingsRail`'s grouping, search, pin affordance and mobile-as-index
  behaviour;
- `TeamSwitcher` (inside `UserMenu`) becomes the scope switcher — it already
  lists the studios a user belongs to, and `useOrgLinks` already supplies the
  organisations that today render as the sidebar's "Organizations" group;
- every existing `/org/{orgId}/*` route, unchanged, so there is no redirect map
  and no link rot.

What is deleted: the eleven-tab strip and the "← Back to dashboard" link, which
frames the org as a modal detour rather than a place you work.

## Switching back — the two-scope toggle

The one real cost of making the org a scope is the click to get back, and an org
admin who also runs a studio pays it all day. So the switcher gets an **alt-tab
affordance: one control, and one shortcut, that flips to the scope you were just
in** (Franco, 2026-08-25).

**It toggles between TWO; it does not cycle N.** What makes alt-tab worth having
is the instant flip between the last two things — the part everyone finds fiddly
is holding a modifier to rotate through a list. With three or more scopes the
switcher menu is already the better tool, so this control always means "back to
the previous one" and never "next in some order".

**A button, not only a shortcut.** A bare chord is undiscoverable; the ⌘K note in
`(auth)/layout.tsx` makes the same point about search losing discoverability
behind an icon. The scope indicator carries a small toggle naming the *target*
scope, so the affordance says what it will do before it does it, and names its
shortcut in the tooltip.

**Suggested chord: ⌘⇧O / Ctrl+Shift+O.** Alt+Tab itself belongs to the OS. The
tempting alternative is ⌘` — literally the macOS idiom for cycling within one
application — but the backtick is a dead key on the Swiss, German and French
layouts this product is built for, which makes it the wrong choice for precisely
this audience. Letters survive every layout.

Three details decide whether it feels right:

- **Remember the previous scope per viewer**, so the toggle survives a reload.
  It is a per-viewer convenience that nothing else depends on, so browser storage
  is the right home and an empty read is a normal state, not an error.
- **No previous scope, no control.** In a first session the button is absent
  rather than present-and-guessing; a toggle that lands somewhere arbitrary is
  worse than no toggle at all.
- **A remembered scope can stop being reachable** — the studio was left, the org
  membership revoked. Resolve it against the scopes the user currently has and
  drop it silently, rather than navigating them into a permission error.

## Risks and open points

- **Scope ambiguity is the whole risk.** The indicator has to be persistent and
  visually distinct, not just the org's name where the studio's name used to be.
  Worth a different accent, not only different text.
- **`OrgProvider` currently wraps only the org layout.** A scope that owns the
  sidebar needs org context resolved higher up, or the sidebar cannot render org
  rows before the org route mounts.
- **Deep links across scopes must switch scope, not merely navigate.** There is
  already one such link, and it is already broken: `settings/team/page.tsx` sends
  an org-managed studio to `/org/{orgId}/settings` for ranking, which has no
  ranking UI (the editor is `/org/{orgId}/ranking`). Under this design that link
  should switch scope and land on the rail's Ranking item. See "The org-managed
  ranking banner links to a page with no ranking UI" in `docs/open-defects.md`.
- **Nav search does not index org destinations.** The sidebar search groups
  pages and settings; org pages should join it once they are real nav items,
  otherwise the switcher becomes the only way in.
- **Multiple organisations** are allowed by the model though HMD is the only one
  today. The switcher handles this by construction; the sidebar-section
  alternative would not have.
- **Mobile.** The rail already knows how to be an index on small screens. The org
  sidebar rows inherit the existing drawer. Neither needs new mobile design —
  which is most of the argument for reusing both patterns.
