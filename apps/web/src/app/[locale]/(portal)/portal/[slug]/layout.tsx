export const dynamic = 'force-dynamic'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>
}
