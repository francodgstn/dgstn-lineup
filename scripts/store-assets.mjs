/**
 * Regenerate the Play store icon and feature graphic from the app icon.
 *
 *   node scripts/store-assets.mjs
 *   node scripts/store-assets.mjs --tagline "Book. Train. Track."
 *
 * Both outputs derive from apps/mobile/assets/icon.png so the app icon stays the
 * single source of truth — change it there and re-run rather than editing the
 * store files by hand. Screenshots are NOT generated here; they are real device
 * captures (apps/mobile/store/README.md).
 *
 * `sharp` is not a direct dependency of this repo — it arrives transitively via
 * Next.js. That is fine for a script run by hand, and the resolve below fails
 * with an instruction rather than a stack trace when it is absent.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let sharp
try {
  sharp = require('sharp')
} catch {
  // Transitive install: resolve it out of the pnpm store rather than failing.
  const store = path.join(ROOT, 'node_modules/.pnpm')
  const dir = fs.existsSync(store) && fs.readdirSync(store).find((d) => d.startsWith('sharp@'))
  if (!dir) {
    console.error('sharp is not installed. Run:  pnpm add -Dw sharp')
    process.exit(1)
  }
  sharp = require(path.join(store, dir, 'node_modules/sharp'))
}

const TAGLINE =
  process.argv.includes('--tagline')
    ? process.argv[process.argv.indexOf('--tagline') + 1]
    : 'Your classes, bookings and membership'

const SRC = path.join(ROOT, 'apps/mobile/assets/icon.png')
const OUT = path.join(ROOT, 'apps/mobile/store')

// Brand purple, matching android.adaptiveIcon.backgroundColor in app.config.js.
const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])

const featureSvg = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='500'>
  <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
    <stop offset='0%' stop-color='#7c3aed'/><stop offset='55%' stop-color='#6d28d9'/><stop offset='100%' stop-color='#4c1d95'/>
  </linearGradient></defs>
  <rect width='1024' height='500' fill='url(#g)'/>
  <circle cx='880' cy='90' r='190' fill='#ffffff' opacity='0.05'/>
  <circle cx='60' cy='450' r='150' fill='#ffffff' opacity='0.04'/>
  <text x='400' y='232' font-family='Segoe UI, Arial, Helvetica, sans-serif' font-size='96' font-weight='700' fill='#ffffff'>Linyup</text>
  <text x='404' y='296' font-family='Segoe UI, Arial, Helvetica, sans-serif' font-size='34' fill='#ffffff' opacity='0.85'>${escapeXml(TAGLINE)}</text>
</svg>`)

// A rounded tile: the raw icon's square edge reads as an artefact on the gradient.
const tileMask = Buffer.from(
  `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='240' height='240' rx='54' ry='54' fill='#fff'/></svg>`
)

fs.mkdirSync(OUT, { recursive: true })

const icon = await sharp(SRC).resize(512, 512, { fit: 'cover' }).png().toFile(path.join(OUT, 'icon-512.png'))
console.log(`icon-512.png                  ${icon.width}x${icon.height}  ${Math.round(icon.size / 1024)}KB`)

const [bg, tile] = await Promise.all([
  sharp(featureSvg).png().toBuffer(),
  sharp(SRC).resize(240, 240).composite([{ input: tileMask, blend: 'dest-in' }]).png().toBuffer(),
])
const feature = await sharp(bg)
  .composite([{ input: tile, left: 110, top: 130 }])
  .png()
  .toFile(path.join(OUT, 'feature-graphic-1024x500.png'))
console.log(`feature-graphic-1024x500.png  ${feature.width}x${feature.height}  ${Math.round(feature.size / 1024)}KB`)
console.log(`tagline: ${TAGLINE}`)
