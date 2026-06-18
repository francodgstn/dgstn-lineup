import { SettingsTabs } from './settings-tabs'

export const metadata = { title: 'Settings · Linyup Ops' }

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Platform-wide configuration, independent of any team or organization.
        </p>
      </div>
      <SettingsTabs />
      {children}
    </div>
  )
}
