'use client'

// Products plugin admin — manage a team's sellable products (merch/equipment).
// Deliberately light: name, image, base price, optional size/colour variants
// (with optional per-variant price override), and an active toggle. No stock.
// Sold via the shared public storefront at /public/{slug}/shop (Products tab).

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { PaymentSettingsLink } from '@/components/connect/PaymentSettingsLink'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Tag, Plus, ImageIcon, X, ExternalLink, Trash2, Pencil } from 'lucide-react'
import { getProductLimits, MAX_PRODUCT_VARIANTS, type Product, type ProductVariant } from '@linyup/shared'
import { formatCurrency } from '@/lib/format'
import {
  useProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  countProducts,
  type ProductInput,
} from '@/plugins/products/hooks'

const MAX_IMAGE_MB = 5

async function uploadImage(file: File, path: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const sRef = storageRef(storage, `${path}.${ext}`)
  await uploadBytes(sRef, file)
  return getDownloadURL(sRef)
}

function newVariant(): ProductVariant {
  return { id: Math.random().toString(36).slice(2, 10), label: '', active: true }
}

type DraftVariant = ProductVariant & { priceText?: string }

interface DraftState {
  name: string
  description: string
  priceText: string
  variantLabel: string
  variants: DraftVariant[]
  active: boolean
  imageUrl?: string
}

function emptyDraft(): DraftState {
  return { name: '', description: '', priceText: '', variantLabel: '', variants: [], active: true }
}

function draftFromProduct(p: Product): DraftState {
  return {
    name: p.name,
    description: p.description ?? '',
    priceText: String(p.priceAmount ?? ''),
    variantLabel: p.variantLabel ?? '',
    variants: (p.variants ?? []).map((v) => ({
      ...v,
      priceText: typeof v.priceAmount === 'number' ? String(v.priceAmount) : '',
    })),
    active: p.active !== false,
    imageUrl: p.imageUrl,
  }
}

function parseAmount(text: string): number | null {
  const n = Number(text.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export default function ProductsPage() {
  const t = useTranslations('Products')
  const { user, currentTeamId, team } = useAuth()
  const queryClient = useQueryClient()
  const currency = team?.default_currency ?? 'CHF'

  const { data: products = [], isLoading } = useProducts(currentTeamId)
  const limits = getProductLimits(team?.plan ?? null)
  const atCap = products.length >= limits.maxProductsPerTeam

  const [editing, setEditing] = useState<Product | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<DraftState>(emptyDraft())
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const shopUrl = team?.slug
    ? typeof window !== 'undefined'
      ? `${window.location.origin}/public/${team.slug}/shop?tab=products`
      : `/public/${team.slug}/shop?tab=products`
    : null

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview(null)
  }

  function pickImage(file: File) {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(t('limitImageSize', { max: MAX_IMAGE_MB }))
      return
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function openCreate() {
    setEditing(null)
    setDraft(emptyDraft())
    clearImage()
    setDialogOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setDraft(draftFromProduct(p))
    clearImage()
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    clearImage()
  }

  function buildInput(): ProductInput | null {
    const price = parseAmount(draft.priceText)
    if (!draft.name.trim() || price == null) {
      toast.error(t('errorInvalid'))
      return null
    }
    const variants: ProductVariant[] = draft.variants
      .filter((v) => v.label.trim())
      .map((v) => {
        const override = v.priceText && v.priceText.trim() ? parseAmount(v.priceText) : null
        const out: ProductVariant = { id: v.id, label: v.label.trim(), active: v.active !== false }
        if (override != null) out.priceAmount = override
        return out
      })
    const input: ProductInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      priceAmount: price,
      variantLabel: variants.length ? draft.variantLabel.trim() || undefined : undefined,
      variants: variants.length ? variants : undefined,
      active: draft.active,
      imageUrl: draft.imageUrl || undefined,
    }
    return input
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentTeamId || !user) throw new Error('Not authenticated')
      const input = buildInput()
      if (!input) throw new Error('INVALID')

      if (!editing) {
        const live = await countProducts(currentTeamId)
        if (live >= limits.maxProductsPerTeam) throw new Error('LIMIT')
        const productId = await createProduct({ teamId: currentTeamId, userId: user.uid, data: input })
        if (imageFile) {
          try {
            const url = await uploadImage(imageFile, `teams/${currentTeamId}/products/${productId}/image`)
            await updateProduct(currentTeamId, productId, { imageUrl: url })
          } catch {
            toast.error(t('errorUpload'))
          }
        }
      } else {
        let imageUrl = input.imageUrl
        if (imageFile) {
          try {
            imageUrl = await uploadImage(imageFile, `teams/${currentTeamId}/products/${editing.id}/image`)
          } catch {
            toast.error(t('errorUpload'))
          }
        }
        await updateProduct(currentTeamId, editing.id, { ...input, imageUrl })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', currentTeamId] })
      closeDialog()
      toast.success(t('saved'))
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'INVALID') return // toast already shown
      toast.error(msg === 'LIMIT' ? t('limitReached', { max: limits.maxProductsPerTeam }) : t('errorSave'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (p: Product) => {
      if (!currentTeamId) throw new Error('Not authenticated')
      await deleteProduct(currentTeamId, p.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', currentTeamId] })
      setDeleteTarget(null)
      toast.success(t('deleted'))
    },
    onError: () => toast.error(t('errorSave')),
  })

  function addVariant() {
    if (draft.variants.length >= MAX_PRODUCT_VARIANTS) return
    setDraft((d) => ({ ...d, variants: [...d.variants, newVariant()] }))
  }

  function updateVariant(id: string, patch: Partial<DraftVariant>) {
    setDraft((d) => ({
      ...d,
      variants: d.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }))
  }

  function removeVariant(id: string) {
    setDraft((d) => ({ ...d, variants: d.variants.filter((v) => v.id !== id) }))
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            {shopUrl ? (
              <a
                href={shopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {shopUrl.replace(/^https?:\/\//, '')}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={openCreate} disabled={atCap} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            {t('newProduct')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('quota', { count: products.length, max: limits.maxProductsPerTeam })}
          </span>
          <PaymentSettingsLink />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <Tag className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card overflow-hidden flex flex-col">
              <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Tag className="h-8 w-8 text-muted-foreground/40" />
                )}
              </div>
              <div className="p-4 flex flex-col gap-1.5 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm leading-tight line-clamp-2">{p.name}</span>
                  {p.active === false && (
                    <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                      {t('hidden')}
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold">{formatCurrency(p.priceAmount, currency)}</p>
                {p.variants && p.variants.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('variantCount', { count: p.variants.length })}
                  </p>
                )}
                <div className="flex items-center gap-1 mt-auto pt-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {t('edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(p)}
                    title={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) closeDialog()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('editProduct') : t('newProduct')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-name">{t('fieldName')}</Label>
              <Input
                id="p-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder={t('namePlaceholder')}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-desc">
                {t('fieldDescription')}{' '}
                <span className="font-normal text-muted-foreground">({t('optional')})</span>
              </Label>
              <Input
                id="p-desc"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder={t('descriptionPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-price">{t('fieldPrice', { currency })}</Label>
              <Input
                id="p-price"
                inputMode="decimal"
                value={draft.priceText}
                onChange={(e) => setDraft((d) => ({ ...d, priceText: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            {/* Image */}
            <div className="space-y-1.5">
              <Label>
                {t('fieldImage')}{' '}
                <span className="font-normal text-muted-foreground">({t('optional')})</span>
              </Label>
              <div className="flex items-center gap-3">
                <div className="h-14 w-24 rounded-md bg-muted overflow-hidden flex items-center justify-center shrink-0">
                  {imagePreview || draft.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagePreview ?? draft.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                  {t('uploadImage')}
                </Button>
                {(imagePreview || draft.imageUrl) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      clearImage()
                      setDraft((d) => ({ ...d, imageUrl: undefined }))
                    }}
                    title={t('removeImage')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) pickImage(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>

            {/* Variants */}
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label>
                  {t('variantsTitle')}{' '}
                  <span className="font-normal text-muted-foreground">({t('optional')})</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addVariant}
                  disabled={draft.variants.length >= MAX_PRODUCT_VARIANTS}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('addVariant')}
                </Button>
              </div>
              {draft.variants.length > 0 && (
                <Input
                  value={draft.variantLabel}
                  onChange={(e) => setDraft((d) => ({ ...d, variantLabel: e.target.value }))}
                  placeholder={t('variantLabelPlaceholder')}
                  className="h-8 text-sm"
                />
              )}
              {draft.variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('variantsHint')}</p>
              ) : (
                <div className="space-y-2">
                  {draft.variants.map((v) => (
                    <div key={v.id} className="flex items-center gap-2">
                      <Input
                        value={v.label}
                        onChange={(e) => updateVariant(v.id, { label: e.target.value })}
                        placeholder={t('variantNamePlaceholder')}
                        className="h-8 text-sm flex-1"
                      />
                      <Input
                        value={v.priceText ?? ''}
                        onChange={(e) => updateVariant(v.id, { priceText: e.target.value })}
                        placeholder={t('variantPricePlaceholder')}
                        inputMode="decimal"
                        className="h-8 text-sm w-24"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeVariant(v.id)}
                        title={t('removeVariant')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">{t('variantPriceHint')}</p>
                </div>
              )}
            </div>

            {/* Active */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('activeLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('activeHint')}</p>
              </div>
              <Switch
                checked={draft.active}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, active: v }))}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('cancel')}
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmBody', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
