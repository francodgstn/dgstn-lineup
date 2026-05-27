import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static',

  // i18n: English at root (/), German at /de/, French at /fr/, Italian at /it/
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de', 'fr', 'it'],
    routing: {
      prefixDefaultLocale: false,
    },
  },

  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
  ],

  vite: {
    resolve: {
      alias: {
        '~': new URL('./src', import.meta.url).pathname,
      },
    },
  },
});
