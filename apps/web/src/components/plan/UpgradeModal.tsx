'use client'

import { Lock, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Link } from '@/i18n/navigation'
import { usePlan } from '@/hooks/usePlan'
import { usePlanName } from '@/hooks/usePlanName'
import type { PlanFeature, SaasPlan } from '@linyup/shared'

interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  feature?: PlanFeature
  minPlan?: SaasPlan
}

const PLAN_COLOR: Record<SaasPlan, { icon: string; badge: string; check: string }> = {
  free: {
    icon: 'text-slate-500',
    badge: 'bg-slate-50 dark:bg-slate-900/20',
    check: 'text-slate-500',
  },
  coach: { icon: 'text-sky-500', badge: 'bg-sky-50 dark:bg-sky-900/20', check: 'text-sky-500' },
  studio: {
    icon: 'text-amber-500',
    badge: 'bg-amber-50 dark:bg-amber-900/20',
    check: 'text-amber-500',
  },
  organization: {
    icon: 'text-violet-500',
    badge: 'bg-violet-50 dark:bg-violet-900/20',
    check: 'text-violet-500',
  },
}

const PLAN_CONTENT: Record<SaasPlan, { tagline: string; features: string[] }> = {
  // The modal never asks anyone to "upgrade" to Free — entry exists only to
  // keep the Record exhaustive.
  free: {
    tagline: 'Get started for free with up to 10 contacts.',
    features: ['Up to 10 active contacts', 'Public bio link', 'Sessions, subscriptions & goals'],
  },
  coach: {
    tagline: 'Everything a solo coach needs to run a professional practice.',
    features: [
      '1:1 coaching slots with client booking',
      'Subscriptions & session packages',
      'Goals, check-ins & progress tracking',
    ],
  },
  studio: {
    tagline: 'Scale with engagement tools, automation, and a mobile app.',
    features: [
      'Student mobile app (iOS & Android)',
      'Gamification — streaks, leaderboards, badges',
      'Outreach automation & multiple managers',
    ],
  },
  organization: {
    tagline: 'Manage multiple locations from a single console.',
    features: [
      'Multi-team management & cross-team events',
      'Unified analytics & reporting',
      'API access & advanced permissions',
    ],
  },
}

export function UpgradeModal({ open, onClose, feature, minPlan }: UpgradeModalProps) {
  const { minimumPlanFor } = usePlan()
  const planName = usePlanName()
  const required: SaasPlan = minPlan ?? (feature ? minimumPlanFor(feature) : 'coach')
  const colors = PLAN_COLOR[required]
  const content = PLAN_CONTENT[required]
  const label = planName(required)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${colors.badge}`}
          >
            <Lock className={`h-5 w-5 ${colors.icon}`} />
          </div>
          <DialogTitle className="text-lg">Upgrade to {label}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-1">{content.tagline}</p>

        <ul className="space-y-2 mt-1">
          {content.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <Check className={`h-4 w-4 mt-0.5 shrink-0 ${colors.check}`} />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-col mt-2">
          <Link
            href="/upgrade"
            onClick={onClose}
            className="w-full text-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Upgrade to {label}
          </Link>
          <div className="flex items-center justify-between w-full pt-1">
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
            <Link
              href="/upgrade"
              onClick={onClose}
              className="text-xs text-primary hover:underline"
            >
              Compare all plans →
            </Link>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
