# Plugins

A plugin packages a feature that not every tenant gets. **Manifests are code**
(`apps/web/src/plugins/*/manifest.ts`, collected in `PLUGIN_REGISTRY`); **only
install state is data** (`teams/{teamId}/installed_plugins/{pluginId}` and
`organizations/{orgId}/installed_plugins/{pluginId}`, doc id = plugin id).

Install state is the gate. `pluginAccessForPlan` decides who *may* install;
studio/organization owners install client-side, Coach activates paid add-ons
through `activatePluginAddon`, and `firestore.rules` refuses a client install
below Studio so paid value cannot be self-granted.

---

## Bundles — a container of plugins

A **container** is a plugin whose install installs others. HMD is the first:
`hmd` holds `hmd-fighting-cup` today and gains modules later.

```
organizations/hmd/installed_plugins/hmd                 ← the container: what a human writes
   config.modules = { 'hmd-fighting-cup': true }        ← DESIRED state
organizations/hmd/installed_plugins/hmd-fighting-cup    ← MATERIALIZED by the reconciler
   installedByBundle: 'hmd'                             ← provenance
```

### Why members are real plugins

Nine things consume install state — the sidebar, plugin nav rows, event types,
the automation rule builder, the server gate, five ad-hoc server gates, the
teardown trigger, billing, and `firestore.rules` — and every one keys off **a
document whose id is the plugin id**. A member that is an ordinary plugin
therefore resolves through all of them with no changes at all. Modelling modules
as a map inside one document would have broken all nine, and rules cannot read
into a config map to decide anything.

The container adds exactly one thing on top: a tenant discovers and installs
**one card**.

This is also why widening `hmd-fighting-cup` needed **no migration**. The
container was added *beside* it; the member kept its id, its `hmd_fighting_cup`
event-type value and its folder.

### Where the composition lives

`PLUGIN_BUNDLES` in `packages/shared/src/types/plugin-bundles.ts` — **not** in
the manifest. The server-side reconciler needs the member list and cannot import
`PLUGIN_REGISTRY` (that lives in `apps/web`). `PLUGIN_ADDONS` next door sets the
same precedent. Declaring it in both places would be a copy for a test to police.

**A member absent from `config.modules` is ON.** A module shipped after a tenant
installed the container must reach them without anybody editing their data; only
an explicit `false` switches one off, and being stored it survives every
reconcile.

### The reconciler

`packages/functions/src/plugins/bundleReconcile.ts` is the **one writer** of a
member install document, driven by two triggers (team + org) in
`bundleTriggers.ts`. It reads the container, diffs desired against actual, and
commits one batch.

Four rules, each of which is a bug if broken — all pinned by
`packages/functions/src/plugins/bundles.test.ts`:

- **Two loop breakers.** The `isBundleContainer` guard stops a member document
  this function just wrote from re-entering as if it were a container; the
  empty-diff early return stops a no-op commit re-firing the trigger it runs
  inside. Neither is an optimisation — without either, the first install loops.
- **It deletes; it never writes `status: 'inactive'`.** That marker means a plan
  lapse, and `orgs/orgTierRails.test.ts` allows exactly two writers of it.
- **It only removes what it created.** A member document without this
  container's `installedByBundle` stamp is a standalone install that predates
  the container, and deleting it would take away a feature the tenant chose for
  itself, config included.
- **`retry: true` is safe** precisely because the function is a pure function of
  current state. This is why it is *not* part of
  `onInstalledPluginStatusChange`, which carries a non-idempotent activation
  hook and must stay `retry: false`.

### The three bundle-aware places

Everything else is bundle-blind, and `bundles.test.ts` re-derives that split from
the source — a new file reading `PLUGIN_REGISTRY` fails until it is classified.

1. **Surfaces that offer an install** call `installableManifests()`: the
   marketplace grid and its `?plugin=` deep link, `DiscoverPanel`, and the org
   catalogue. A member is not offered; the container is.
2. **The reconciler.**
3. **The container's config panel**, plus `settings/event-types`, which keeps
   showing a member's event type (it offers no install) but gates on the
   **container's** audience and prints the **container's** name.

The container's module switches live on the **org** plugins page, and have to:
an org-managed install deliberately shows no Configure control on a studio's own
settings page, and HMD installs at org level.

---

## Audience — discovery, never running

`PluginAudience` + `pluginVisibleToTenant` keep one customer's name out of every
other tenant's catalogue. **Nothing that resolves an INSTALLED plugin consults
it.** A tenant dropped from the list keeps its card, its Configure and its
Remove — a list edit must not be a data change with an outage in it.

`pluginIsInstallable` is a separate, orthogonal predicate: audience asks "may
*this tenant* see it?", installability asks "does *anyone* install this
directly?" and does not depend on the tenant. Fusing them would overload a
function whose contract is that an absent audience means public.

---

## The server gate

`pluginIsActive(teamId, pluginId)` / `assertPluginInstalled` /
`resolveActivePluginInstall` in `packages/functions/src/utils/plugins.ts`.

**Gate creation, never consumption.** Selling a gift card is gated; redeeming one
already sold is not — that would be the studio keeping a customer's money and
giving nothing back.

**It resolves the team install, then the org one.** `org_id` IS the grant, the
same doctrine `useInstalledPlugins` states on the client. This function once read
the team path only, which made every org-level install invisible to every
server-side gate — a studio could see a feature in its own sidebar and be refused
by the callable behind it.

**An inactive team document does not veto an active org one**, and the obvious
reading is wrong here: the client filters to `status === 'active'` *first* and
only then lets a team entry take precedence. A server where the team document
wins merely by existing refuses what the studio can see.

---

## Contributions

A manifest DECLARES; a registry IMPLEMENTS. Declarations must be serializable
data (catalogues and rule builders read them without loading plugin code);
implementations must be code. That is why `automationActions` sits in the
manifest while `pluginActionHandlers` sits in `packages/functions/src/plugins/`.

| Contribution | Declared | Resolved |
|---|---|---|
| Sidebar rows | `navContributions` | `usePluginNavEntries` (`(auth)/layout.tsx`) |
| Event type | `eventType` | `useEventTypes`, `CheckinPanel` |
| Automation triggers/actions | `automationTriggers` / `automationActions` | `pluginActionHandlers` |
| Icons | `iconName`, `navContributions[].icon` | `PLUGIN_ICON_MAP` (`plugins/icons.tsx`) |
| UI components | `hasOwnerConfig`, `eventType.has*` | `pluginSlot()` (`plugins/slots.ts`), by convention |

**`pluginSlot` resolves by convention**: a plugin ships
`@/plugins/{id}/{Slot}.tsx` exporting a symbol named for the slot, and nothing
central is edited. The slot names are a closed union because a typo in a dynamic
import path fails at runtime, in the one branch that renders it. The per-slot
`switch` is deliberate — a fully dynamic path would make webpack build a context
over every file under `plugins/`.

Icons resolve through **one** map. There used to be three, and they had already
drifted: the org catalogue's copy was missing five icons, so five plugins
rendered a fallback puzzle piece on that page and nowhere else. The map stays
explicit rather than using `DynamicIcon`, which reaches its result via
`import * as LucideIcons` and would pull the whole icon set into the
authenticated layout.

---

## Adding a plugin

1. `apps/web/src/plugins/<id>/manifest.ts`, registered in `registry.ts`.
2. Its icon in `plugins/icons.tsx` if not already there.
3. Message keys via `apps/web/messages/_pending/<lane>.json`, then
   `pnpm i18n:merge` — **never edit the four locale files directly**.
4. A teardown arm in `onInstalledPluginStatusChange` **only** if the plugin
   publishes something public; if you add one, add its copy to
   `REMOVE_EFFECT_KEY`, because the default text promises the data is kept.
5. To make it a bundle member: one line in `PLUGIN_BUNDLES`. Nothing else — the
   catalogues and the reconciler follow.
