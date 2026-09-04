import { SettingsNav } from './settings-nav'

export const metadata = { title: 'Settings · Linyup Ops' }

// Master-detail, matching the main app's /settings shell: the rail stays put and
// the pane swaps. Wider than the old single column — these pages carry tables and
// key/value grids that were wrapping at max-w-3xl with the sidebar already
// costing 15rem.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-wide configuration, independent of any team or organization.
        </p>
      </div>
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <aside className="md:w-52 md:shrink-0">
          <div className="md:sticky md:top-6">
            <SettingsNav />
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
