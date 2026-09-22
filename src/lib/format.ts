import type { Locale } from '#/i18n/i18n'

// Dates: Latin digits in both languages (Moroccan usage), month names localized.
const tag = (l: Locale) => (l === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA')

export function formatDate(iso: string | null | undefined, locale: Locale, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return new Intl.DateTimeFormat(tag(locale), opts ?? { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

export function formatDateTime(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(tag(locale), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatMoney(n: number | string | null | undefined, locale: Locale) {
  const v = Number(n ?? 0)
  return new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'MAD', maximumFractionDigits: 2 }).format(v)
}

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ISO weekday 1 = Monday ... 7 = Sunday
export function isoWeekday(iso: string) {
  const d = new Date(`${iso}T12:00:00`).getDay()
  return d === 0 ? 7 : d
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function mondayOf(iso: string) {
  return addDays(iso, 1 - isoWeekday(iso))
}
