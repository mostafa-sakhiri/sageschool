import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import fr from './fr.json'
import ar from './ar.json'

export type Locale = 'fr' | 'ar'
type Dict = Record<string, string>
const dicts: Record<Locale, Dict> = { fr, ar }

type I18n = {
  locale: Locale
  dir: 'ltr' | 'rtl'
  setLocale: (l: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n | null>(null)

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>) {
  // Missing Arabic keys fall back to French, then to the key itself.
  let s = dicts[locale][key] ?? dicts.fr[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export function I18nProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial)
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = l
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'
    setLocaleState(l)
  }, [])
  const value = useMemo<I18n>(
    () => ({
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// Outside the provider (root error/not-found boundaries): French, LTR.
const fallback: I18n = { locale: 'fr', dir: 'ltr', setLocale: () => {}, t: (k, v) => translate('fr', k, v) }

export function useI18n() {
  return useContext(I18nContext) ?? fallback
}

export const useT = () => useI18n().t
