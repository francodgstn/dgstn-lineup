'use client'

// Shell for the "Pricing" section of the How-to page — composes the three
// sub-parts (money map, recipe cookbook, live simulator) under one heading,
// the same way PublicPages/CoreConcepts each own their own section.
import { useTranslations } from 'next-intl'
import { PricingMoneyMap } from './pricing/PricingMoneyMap'
import { PricingRecipes } from './pricing/PricingRecipes'
import { PricingSimulator } from './pricing/PricingSimulator'

export function PricingHowTo() {
  const t = useTranslations('HowTo')

  return (
    <section>
      <h2 className="text-lg font-semibold">{t('pricing.title')}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('pricing.intro')}</p>

      <div className="mt-8">
        <PricingMoneyMap />
      </div>
      <div className="mt-10">
        <PricingRecipes />
      </div>
      <div className="mt-10">
        <PricingSimulator />
      </div>
    </section>
  )
}
