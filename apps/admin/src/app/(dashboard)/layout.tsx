import { requireOperator } from '@/lib/require-operator'
import { describeFirebaseTarget } from '@/lib/firebase-admin'
import { NavLinks } from '@/components/nav-links'
import { SignOutButton } from '@/components/sign-out-button'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const operator = await requireOperator()
  // Which backend this console is pointed at (emulator / sandbox / prod) — always
  // visible so a policy flip or plan override can't land on the wrong project.
  const target = describeFirebaseTarget()
  const targetClass = target.isProd
    ? 'text-[11px] font-medium text-amber-600'
    : 'text-[11px] text-muted-foreground'

  return (
    <div className="flex min-h-screen flex-col">
      {/* Ops accent bar — unmistakable vs the customer app */}
      <div className="h-1 w-full bg-primary" />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r bg-card px-3 py-4 md:flex">
          <div className="mb-6 flex flex-col gap-0.5 px-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 items-center rounded-md bg-primary px-1.5 text-xs font-bold tracking-wide text-primary-foreground">
                OPS
              </span>
              <span className="text-sm font-semibold">Linyup</span>
            </div>
            <span className={`${targetClass} truncate font-mono`} title="Firebase project this console operates on">
              {target.label}
            </span>
          </div>
          <NavLinks />
        </aside>
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b bg-card px-6">
            <span className="text-sm text-muted-foreground md:hidden">
              Linyup Ops <span className={`${targetClass} font-mono`}>· {target.label}</span>
            </span>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{operator.email}</span>
              <SignOutButton />
            </div>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
