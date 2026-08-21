/**
 * Exercises the path mapping without deploying anything.
 *
 *     node --experimental-strip-types scripts/check-paths.ts
 *
 * Imports the real functions from `../src/paths.ts` rather than restating them,
 * so this cannot quietly drift from what the Worker actually does.
 */

import { isPassthrough, toInternalPath, toPublicPath } from '../src/paths.ts'

const SLUG = 'hmd-basel'
let failures = 0

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${String(actual)}`)
}

console.log('\n— tenant path → internal path —')
check('/', toInternalPath('/', SLUG), `/public/${SLUG}`)
check('/shop', toInternalPath('/shop', SLUG), `/public/${SLUG}/shop`)
check('/shop/ (trailing slash)', toInternalPath('/shop/', SLUG), `/public/${SLUG}/shop`)
check('/space/courses/x', toInternalPath('/space/courses/x', SLUG), `/public/${SLUG}/space/courses/x`)
check('/de', toInternalPath('/de', SLUG), `/de/public/${SLUG}`)
check('/de/shop', toInternalPath('/de/shop', SLUG), `/de/public/${SLUG}/shop`)
check('/fr/booking', toInternalPath('/fr/booking', SLUG), `/fr/public/${SLUG}/booking`)
// 'en' is NOT a prefix under localePrefix:'as-needed' — it must stay a path segment.
check('/en/shop (en is not a locale prefix)', toInternalPath('/en/shop', SLUG), `/public/${SLUG}/en/shop`)

console.log('\n— internal path → tenant path (redirect Location) —')
check('/public/{slug}', toPublicPath(`/public/${SLUG}`, SLUG), '/')
check('/public/{slug}/shop', toPublicPath(`/public/${SLUG}/shop`, SLUG), '/shop')
check('/de/public/{slug}/shop', toPublicPath(`/de/public/${SLUG}/shop`, SLUG), '/de/shop')
check('/de/public/{slug}', toPublicPath(`/de/public/${SLUG}`, SLUG), '/de/')
check('unrelated path untouched', toPublicPath('/login', SLUG), '/login')
check('other tenant untouched', toPublicPath('/public/other/shop', SLUG), '/public/other/shop')

console.log('\n— round trip —')
for (const p of ['/', '/shop', '/de/shop', '/fr/booking', '/space/courses/x']) {
  check(`${p} → internal → back`, toPublicPath(toInternalPath(p, SLUG), SLUG), p)
}

console.log('\n— passthrough —')
for (const p of ['/_next/static/a.js', '/api/x', '/pay/result', '/embed/s/1', '/favicon.ico', '/robots.txt', '/embed.js', '/de/embed/s/1', '/anything.png']) {
  check(`passthrough ${p}`, isPassthrough(p), true)
}
for (const p of ['/', '/shop', '/de/shop', '/space', '/booking/yoga']) {
  check(`NOT passthrough ${p}`, isPassthrough(p), false)
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
