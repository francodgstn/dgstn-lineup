import de from './locales/de.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import it from './locales/it.json';

export const languages = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
} as const;

export const defaultLang = 'en';
export type Language = keyof typeof languages;

export const translations = { en, de, fr, it } as const;

/** Extract the locale from an Astro URL. Falls back to defaultLang. */
export function getLangFromUrl(url: URL): Language {
  const [, maybeLang] = url.pathname.split('/');
  if (maybeLang in languages) return maybeLang as Language;
  return defaultLang;
}

/**
 * Returns a translation function for the given locale.
 * Supports dot-notation keys, e.g. t('hero.title').
 * Falls back to English when a key is missing in the requested locale.
 */
export function useTranslations(lang: Language) {
  return function t(key: string): string {
    const keys = key.split('.');
    let value: unknown = translations[lang];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[k];
      } else {
        // Fall back to English
        if (lang !== defaultLang) {
          let fallback: unknown = translations[defaultLang];
          for (const fk of keys) {
            if (fallback && typeof fallback === 'object' && fk in (fallback as Record<string, unknown>)) {
              fallback = (fallback as Record<string, unknown>)[fk];
            } else {
              return key;
            }
          }
          return typeof fallback === 'string' ? fallback : key;
        }
        return key;
      }
    }

    return typeof value === 'string' ? value : key;
  };
}

/** Build a locale-prefixed path. English keeps no prefix (prefixDefaultLocale: false). */
export function getLocalizedPath(path: string, lang: Language): string {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  if (lang === defaultLang) return clean ? `/${clean}` : '/';
  return clean ? `/${lang}/${clean}` : `/${lang}`;
}

/** Strip any locale prefix from a path. */
export function stripLocale(path: string): string {
  const [, maybeLang, ...rest] = path.split('/');
  if (maybeLang in languages) return `/${rest.join('/')}`;
  return path;
}
