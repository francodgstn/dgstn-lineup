// TODO: Port from hmd-lineup/src/routes/Portal/routes/TrialBooking/
// Key reference: hmd-lineup/src/routes/Portal/routes/TrialBooking/components/TrialBookingPage/TrialBookingPage.hook.js
// Pattern: resolve team via public_profile, list sessions with allowBooking=true,
//          call bookTrialSession Cloud Function with sendBookingVerificationCode for email auth

interface Props {
  params: Promise<{ slug: string }>
}

export default async function TrialBookingPage({ params }: Props) {
  const { slug } = await params

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Book a Trial Class</h1>
        <p className="text-muted-foreground">Choose a session and fill in your details to reserve your spot.</p>
      </div>

      <div className="bg-muted/40 border rounded-xl p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Trial booking form — coming soon.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Port from <code className="bg-muted px-1 rounded">hmd-lineup/src/routes/Portal/routes/TrialBooking/</code>
        </p>
      </div>
    </div>
  )
}
