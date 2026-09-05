// Pure helpers over `ListAvailabilityDuration` / `ListAvailabilityActivity`
// (@linyup/shared) — appointments have NO `accessRule`; money (`durations` +
// `memberBenefit`) is the only gate (see the module header of
// packages/functions/src/appointments/window.ts). `AppointmentBookingModal`
// used to read `activity.accessRule.type`, which no longer exists on the
// wire and crashed the app for any coach with activities — this file is what
// replaced that read.
import type { ListAvailabilityActivity, ListAvailabilityDuration } from '../types';

/**
 * Does this activity carry a members-only benefit worth flagging in the UI?
 * True when a `memberBenefit` rule names at least one covering subscription
 * type — never a second access gate, just a badge over money that is already
 * the gate.
 */
export function activityHasMemberBenefit(activity: Pick<ListAvailabilityActivity, 'memberBenefit'>): boolean {
  const benefit = activity.memberBenefit;
  return !!benefit && Array.isArray(benefit.subscriptionTypeIds) && benefit.subscriptionTypeIds.length > 0;
}

/**
 * Is this particular duration bookable only through the member benefit
 * (`benefitOnly`) — distinct from `priceAmount: null`, which means free for
 * anyone.
 */
export function durationIsBenefitOnly(duration: Pick<ListAvailabilityDuration, 'benefitOnly'>): boolean {
  return duration.benefitOnly === true;
}
