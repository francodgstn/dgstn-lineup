import { AnnouncementBar } from '@/components/layout/AnnouncementBar'

// Public (unauthenticated) route group — tenant pages (bio-link, site, space,
// shop, booking, signup…). Wraps them with the OPS announcement strip so the
// "this is a demo" notice also shows on the sandbox's public surfaces. The bar
// renders nothing unless an announcement is enabled.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnnouncementBar />
      {children}
    </>
  )
}
