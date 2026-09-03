import { activityHasMemberBenefit, durationIsBenefitOnly } from './appointmentAccess';

describe('activityHasMemberBenefit', () => {
  it('is false when the activity carries no memberBenefit', () => {
    expect(activityHasMemberBenefit({ memberBenefit: null })).toBe(false);
  });

  it('is false when the benefit names no subscription types', () => {
    expect(
      activityHasMemberBenefit({
        memberBenefit: { subscriptionTypeIds: [], kind: 'included' } as any,
      })
    ).toBe(false);
  });

  it('is true when the benefit names at least one subscription type', () => {
    expect(
      activityHasMemberBenefit({
        memberBenefit: { subscriptionTypeIds: ['sub-1'], kind: 'included' } as any,
      })
    ).toBe(true);
  });
});

describe('durationIsBenefitOnly', () => {
  it('is false when absent', () => {
    expect(durationIsBenefitOnly({})).toBe(false);
  });

  it('is distinct from priceAmount: null (free-for-anyone) — only benefitOnly:true counts', () => {
    expect(durationIsBenefitOnly({ benefitOnly: false })).toBe(false);
    expect(durationIsBenefitOnly({ benefitOnly: true })).toBe(true);
  });
});
