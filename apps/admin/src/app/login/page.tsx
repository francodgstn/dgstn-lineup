import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex h-7 items-center rounded-md bg-primary px-2 text-xs font-bold tracking-wide text-primary-foreground">
            OPS
          </span>
          <span className="text-lg font-semibold">Linyup Operator Console</span>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Internal use only. Sign in with an authorized operator account.
        </p>
        <LoginForm />
      </div>
    </main>
  )
}
