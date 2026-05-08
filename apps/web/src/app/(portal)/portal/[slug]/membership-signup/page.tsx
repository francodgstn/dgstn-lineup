// TODO: Port from hmd-lineup/src/routes/Portal/routes/MembershipSignup/
// Pattern: collect email → call sendMembershipVerificationCode → verify code → completeMembershipSignup

interface Props {
  params: Promise<{ slug: string }>
}

export default async function MembershipSignupPage({ params }: Props) {
  const { slug } = await params

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Membership Signup</h1>
        <p className="text-muted-foreground">Join us as a member. We&apos;ll send you a verification code to get started.</p>
      </div>

      <div className="bg-muted/40 border rounded-xl p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Membership signup form — coming soon.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Port from <code className="bg-muted px-1 rounded">hmd-lineup/src/routes/Portal/routes/MembershipSignup/</code>
        </p>
      </div>
    </div>
  )
}
