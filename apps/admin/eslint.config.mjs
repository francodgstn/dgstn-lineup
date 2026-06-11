// Flat ESLint config. Next.js 16 removed the `next lint` CLI — lint runs via
// the ESLint CLI directly (`pnpm lint`), with the Next.js rules pulled in
// through FlatCompat (eslint-config-next still ships eslintrc-style configs).
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'],
  },
]

export default eslintConfig
