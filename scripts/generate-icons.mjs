/**
 * Generate app icons from the Linyup brand mark (apps/landing/public/favicon.svg).
 *
 * One-off utility — re-run after changing the brand mark:
 *   node scripts/generate-icons.mjs
 *
 * Outputs:
 *   apps/web/src/app/apple-icon.png   180×180  (Next.js apple-touch-icon)
 *   apps/mobile/assets/icon.png           1024×1024 full-bleed (iOS rounds corners itself)
 *   apps/mobile/assets/adaptive-icon.png  1024×1024 white swoosh on transparent (Android foreground)
 *   apps/mobile/assets/splash-icon.png    1024×1024 rounded-square logo, transparent padding
 *   apps/mobile/assets/favicon.png        48×48    (Expo web)
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const sharp = require('./../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp')

const brandSvg = readFileSync('apps/landing/public/favicon.svg')

// Full-bleed variant (no rounded corners) — iOS/app icons are masked by the OS
const fullBleedSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#5b21b6"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#bg)"/>
  <path d="M22 80 Q44 78 58 54 T82 22" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
</svg>`)

// Android adaptive foreground: white swoosh on transparent, glyph inside the
// ~66% safe zone (the launcher masks the outer area; bg color set in app.config.js)
const adaptiveSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g transform="translate(50 50) scale(0.42) translate(-50 -50)">
    <path d="M22 80 Q44 78 58 54 T82 22" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
  </g>
</svg>`)

// Splash: rounded-square logo at 40% of canvas, rest transparent (resizeMode: contain)
const splashSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 250">
  <g transform="translate(75 75)">${readFileSync('apps/landing/public/favicon.svg', 'utf8')
    .replace(/<\/?svg[^>]*>/g, '')
    .replace('id="bg"', 'id="bgs"').replace('url(#bg)', 'url(#bgs)')}</g>
</svg>`)

const jobs = [
  { src: brandSvg,     out: 'apps/web/src/app/apple-icon.png',         size: 180 },
  { src: fullBleedSvg, out: 'apps/mobile/assets/icon.png',             size: 1024 },
  { src: adaptiveSvg,  out: 'apps/mobile/assets/adaptive-icon.png',    size: 1024 },
  { src: splashSvg,    out: 'apps/mobile/assets/splash-icon.png',      size: 1024 },
  { src: brandSvg,     out: 'apps/mobile/assets/favicon.png',          size: 48 },
]

for (const { src, out, size } of jobs) {
  await sharp(src, { density: 72 * (size / 100) * 1.5 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out)
  console.log(`✓ ${out} (${size}×${size})`)
}
