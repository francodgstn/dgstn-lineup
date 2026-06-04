'use client'

import { createContext, useContext, useState } from 'react'
import { UpgradeModal } from '@/components/plan/UpgradeModal'
import type { PlanFeature, SaasPlan } from '@linyup/shared'

interface OpenOptions {
  minPlan?: SaasPlan
  feature?: PlanFeature
}

interface UpgradeModalContextType {
  openUpgradeModal: (opts?: OpenOptions) => void
}

const UpgradeModalContext = createContext<UpgradeModalContextType | null>(null)

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<OpenOptions | null>(null)

  return (
    <UpgradeModalContext.Provider value={{ openUpgradeModal: (o) => setOpts(o ?? {}) }}>
      {children}
      <UpgradeModal
        open={opts !== null}
        onClose={() => setOpts(null)}
        minPlan={opts?.minPlan}
        feature={opts?.feature}
      />
    </UpgradeModalContext.Provider>
  )
}

export function useUpgradeModal(): UpgradeModalContextType {
  const ctx = useContext(UpgradeModalContext)
  if (!ctx) throw new Error('useUpgradeModal must be used within UpgradeModalProvider')
  return ctx
}
