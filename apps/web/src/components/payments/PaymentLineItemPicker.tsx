'use client'

// Structured "what was paid" picker → emits a PaymentLineItem (or null). Linking a
// subscription/course/product drives the real effects server-side (subscription
// fields / course unlock / credits). Used by the assign + record-payment dialogs.

import { useTranslations } from 'next-intl'
import type { PaymentLineItem, PaymentLineItemKind } from '@linyup/shared'
import { useSubscriptionTypes } from '@/hooks/useSubscriptionTypes'
import { useCourses } from '@/plugins/online-courses/hooks'
import { useProducts } from '@/plugins/products/hooks'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const KINDS: PaymentLineItemKind[] = ['subscription', 'course', 'product', 'drop_in', 'other']

export function PaymentLineItemPicker({
  teamId,
  value,
  onChange,
}: {
  teamId: string
  value: PaymentLineItem | null
  onChange: (li: PaymentLineItem | null) => void
}) {
  const t = useTranslations('PaymentsDashboard')
  const { data: types = [] } = useSubscriptionTypes(teamId)
  const { data: courses = [] } = useCourses(teamId)
  const { data: products = [] } = useProducts(teamId)

  const kind = value?.kind ?? 'none'
  const selectedType = types.find((ty) => ty.id === value?.subscriptionTypeId)
  const prices = (selectedType?.prices ?? []).filter((p) => p.active !== false)
  const selectedProduct = products.find((p) => p.id === value?.productId)

  function setKind(k: string | null) {
    if (!k || k === 'none') return onChange(null)
    const nk = k as PaymentLineItemKind
    if (nk === 'drop_in') onChange({ kind: 'drop_in', label: t('lineKind_drop_in') })
    else if (nk === 'other') onChange({ kind: 'other' })
    else onChange({ kind: nk }) // subscription/course/product → pick the ref next
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label>{t('lineItemLabel')}</Label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger>
            <SelectValue placeholder={t('lineKind_none')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('lineKind_none')}</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`lineKind_${k}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Subscription → type + price */}
      {kind === 'subscription' && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={value?.subscriptionTypeId ?? ''}
            onValueChange={(id) => {
              const ty = types.find((x) => x.id === id)
              onChange({ kind: 'subscription', subscriptionTypeId: id, label: ty?.name ?? null })
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('selectType')} />
            </SelectTrigger>
            <SelectContent>
              {types.map((ty) => (
                <SelectItem key={ty.id} value={ty.id}>
                  {ty.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={value?.priceId ?? ''}
            onValueChange={(pid) => {
              const price = prices.find((p) => p.id === pid)
              const label = selectedType
                ? `${selectedType.name}${price?.label ? ` — ${price.label}` : ''}`
                : (value?.label ?? null)
              onChange({
                kind: 'subscription',
                subscriptionTypeId: value?.subscriptionTypeId,
                priceId: pid,
                label,
              })
            }}
            disabled={!selectedType}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('selectPrice')} />
            </SelectTrigger>
            <SelectContent>
              {prices.map((p) => (
                // Explicit string `label` so the trigger shows text (not the id) —
                // the Select only registers value→label when the item's label/children
                // is a plain string, and this item's content is multi-node.
                <SelectItem
                  key={p.id}
                  value={p.id}
                  label={[p.label, p.recurrence, p.credits ? `${p.credits}×` : null]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Course */}
      {kind === 'course' && (
        <Select
          value={value?.courseId ?? ''}
          onValueChange={(id) => {
            const c = courses.find((x) => x.id === id)
            onChange({ kind: 'course', courseId: id, label: c?.title ?? null })
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('selectCourse')} />
          </SelectTrigger>
          <SelectContent>
            {courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Product → product + optional variant */}
      {kind === 'product' && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={value?.productId ?? ''}
            onValueChange={(id) => {
              const p = products.find((x) => x.id === id)
              onChange({ kind: 'product', productId: id, label: p?.name ?? null })
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('selectProduct')} />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(selectedProduct?.variants?.length ?? 0) > 0 && (
            <Select
              value={value?.variantId ?? ''}
              onValueChange={(vid) => {
                const v = selectedProduct?.variants?.find((x) => x.id === vid)
                onChange({
                  kind: 'product',
                  productId: value?.productId,
                  variantId: vid,
                  label: `${selectedProduct?.name ?? 'Product'}${v?.label ? ` · ${v.label}` : ''}`,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('selectVariant')} />
              </SelectTrigger>
              <SelectContent>
                {(selectedProduct?.variants ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}
