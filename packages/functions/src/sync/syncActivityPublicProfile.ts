// Keeps activities/{activityId}/public_profile/{activityId} in sync
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { resolveActivityAccessRule } from '@linyup/shared'


export const syncActivityPublicProfile = onDocumentWritten('activities/{activityId}', async (event) => {
  const { activityId } = event.params
  const afterRef = event.data!.after.ref

  // Remove public profile when document is deleted or activity is deactivated
  if (!event.data!.after.exists || event.data!.after.data()?.isActive === false) {
    await afterRef.collection('public_profile').doc(activityId).delete()
    return
  }

  const data = event.data!.after.data()!

  const publicProfile = {
    type: 'activity',
    teamId: data.teamId,
    // Session category ('class' | 'appointment') so public UIs can route
    // appointment activities to the appointment flow instead of the class slot picker.
    activityType: data.type === 'appointment' ? 'appointment' : 'class',
    name: data.name || '',
    description: data.description || '',
    slug: data.slug || '',
    color: data.color || null,
    image_url: data.image_url || null,
    // Denormalised display order so public consumers sort like the admin list.
    order: typeof data.order === 'number' ? data.order : null,
    isFreeTrial: data.isFreeTrial || false,
    level: data.level || null,
    // Denormalised access gate so the public booking UI can render lock badges.
    // CLASS-ONLY: appointments have no access gate (the price is the gate) —
    // mirroring a resolved rule for them would resurrect a phantom {type:'open'}.
    ...(data.type !== 'appointment'
      ? { accessRule: resolveActivityAccessRule({ accessRule: data.accessRule, isFreeTrial: data.isFreeTrial }) }
      : {}),
    // Drop-in config so the booking UI can offer pay-per-class (only when enabled + priced).
    ...(data.dropIn?.enabled && typeof data.dropIn.priceAmount === 'number'
      ? { dropIn: { enabled: true, priceAmount: data.dropIn.priceAmount } }
      : {}),
    // CLASS-ONLY trial door: without this the public booking flow can't OFFER
    // the trial the admin toggled on — the promise "even when members-only"
    // needs the mirror to carry it.
    ...(data.type !== 'appointment' && data.trialEnabled === true ? { trialEnabled: true } : {}),
    // CLASS-ONLY paid-trial price — mirrored only alongside a live trial door
    // (same conditional style as trialEnabled above). Absent ⇒ the trial stays
    // FREE, today's behaviour untouched.
    ...(data.type !== 'appointment' &&
    data.trialEnabled === true &&
    typeof data.trialPriceAmount === 'number'
      ? { trialPriceAmount: data.trialPriceAmount }
      : {}),
    // Appointment duration menu with base prices so public cards can show
    // "from CHF 45". Mirrored verbatim — no per-contact data to strip any more
    // (the old subscriptionPricing matrix is gone).
    ...(data.type === 'appointment' && Array.isArray(data.durations) && data.durations.length
      ? {
          durations: data.durations.map((d: { minutes: number; priceAmount?: number | null }) => ({
            minutes: d.minutes,
            priceAmount: d.priceAmount ?? null,
          })),
        }
      : {}),
    // The one member-benefit rule, mirrored verbatim — public-safe, since the
    // referenced subscription-type ids are already public in the shop.
    // Appointments: applies to every priced duration. Classes: the member rate
    // on the drop-in price — only meaningful (and only mirrored) alongside a
    // live, priced drop-in.
    ...(data.type === 'appointment' && data.memberBenefit
      ? { memberBenefit: data.memberBenefit }
      : {}),
    ...(data.type !== 'appointment' &&
    data.memberBenefit &&
    data.dropIn?.enabled &&
    typeof data.dropIn.priceAmount === 'number'
      ? { memberBenefit: data.memberBenefit }
      : {}),
    // Display-only prerequisites shown on the public booking pages.
    prerequisites: data.prerequisites || null,
  }

  await afterRef.collection('public_profile').doc(activityId).set(publicProfile)
})
