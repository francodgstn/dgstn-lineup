'use client'

// Convention-based resolution of a plugin's UI contributions.
//
// A plugin that declares a capability in its manifest ships the component at a
// known path in its own folder — `@/plugins/{pluginId}/{Slot}.tsx`, exporting a
// named symbol equal to the slot. Nothing central has to be edited for a new
// plugin to contribute one, which is the whole point: the alternative is a
// hardcoded map per slot, and those had already accumulated (a CONFIG_PANELS
// record, a direct `CategoryManager` import naming one customer's plugin in a
// core page, and two inline `dynamic()` calls with the convention spelled out
// by hand).
//
// The slot names are a CLOSED union rather than a free string. A typo in a
// dynamic import path fails at runtime, in the one branch that renders it —
// which for a rarely-opened panel means it fails in front of a customer.
//
// ── WHY THE SWITCH, AND WHY IT MUST NOT BE COLLAPSED ─────────────────────────
// Webpack resolves `import()` at BUILD time and needs a statically analysable
// path. A fully dynamic `import(`@/plugins/${id}/${slot}`)` produces a context
// covering every file under plugins/, so an unrelated component in any plugin
// folder becomes reachable from every bundle that touches this module. One
// template literal per slot keeps each context to "one named file per plugin".
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

export type PluginSlot = 'CheckinForm' | 'Exports' | 'CategoryManager' | 'ConfigPanel'

/**
 * The plugin's component for `slot`, lazily loaded, or null when the plugin
 * ships none.
 *
 * Callers must treat null as "this plugin does not contribute here" and render
 * nothing — never as an error. A manifest flag says a contribution EXISTS; this
 * says whether it could be loaded.
 */
export function pluginSlot<P = Record<string, unknown>>(
  pluginId: string,
  slot: PluginSlot,
): ComponentType<P> | null {
  switch (slot) {
    case 'CheckinForm':
      return dynamic<P>(
        () => import(`@/plugins/${pluginId}/CheckinForm`).then((m) => ({ default: m.CheckinForm })),
        { ssr: false },
      )
    case 'Exports':
      return dynamic<P>(
        () => import(`@/plugins/${pluginId}/Exports`).then((m) => ({ default: m.Exports })),
        { ssr: false },
      )
    case 'CategoryManager':
      return dynamic<P>(
        () =>
          import(`@/plugins/${pluginId}/CategoryManager`).then((m) => ({
            default: m.CategoryManager,
          })),
        { ssr: false },
      )
    case 'ConfigPanel':
      return dynamic<P>(
        () => import(`@/plugins/${pluginId}/ConfigPanel`).then((m) => ({ default: m.ConfigPanel })),
        { ssr: false },
      )
    default:
      return null
  }
}
