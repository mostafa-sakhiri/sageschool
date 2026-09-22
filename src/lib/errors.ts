type T = (key: string, vars?: Record<string, string | number>) => string

// Postgres/PostgREST errors carry a code; database triggers already raise
// readable French messages, which are shown as-is.
export function errorMessage(error: unknown, t: T): string {
  if (!error) return t('errors.generic')
  const e = error as { code?: string; message?: string; details?: string }
  switch (e.code) {
    case '23505':
      return t('errors.duplicate')
    case '23P01':
    case '23514':
    case 'P0001':
    case '22023':
      return e.message ?? t('errors.generic')
    case '42501':
      return t('errors.forbidden')
    case '23503':
      return t('errors.inUse')
    case 'PGRST116':
      return t('errors.notFound')
  }
  if (e.message?.includes('Invalid login credentials')) return t('errors.badCredentials')
  return e.message ?? t('errors.generic')
}

// supabase-js returns { data, error }; throw so TanStack Query sees failures.
export function must<D>(res: { data: D; error: unknown }): NonNullable<D> {
  if (res.error) throw res.error
  return res.data as NonNullable<D>
}
