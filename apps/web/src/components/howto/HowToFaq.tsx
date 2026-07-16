'use client'

// Early-days FAQ told as short stories around a recurring persona (Alex, who
// runs a small martial-arts studio — introduced once in the intro line).
// Conceptual answers, deliberately without in-app links.
import { useTranslations } from 'next-intl'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const

export function HowToFaq() {
  const t = useTranslations('HowTo')

  return (
    <section>
      <h2 className="text-lg font-semibold">{t('faqTitle')}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('faqIntro')}</p>

      <Accordion className="mt-4">
        {FAQ_KEYS.map((k) => (
          <AccordionItem key={k} value={k}>
            <AccordionTrigger>{t(`faq.${k}.q` as Parameters<typeof t>[0])}</AccordionTrigger>
            <AccordionContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(`faq.${k}.a` as Parameters<typeof t>[0])}
              </p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
