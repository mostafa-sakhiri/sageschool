import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { createClient } from './supabase/server'

export type Claims = { sub: string; email?: string }

// The only trusted identity check: verifies the JWT signature (getClaims).
export const fetchClaims = createServerFn({ method: 'GET' }).handler(async (): Promise<Claims | null> => {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims) return null
  return { sub: data.claims.sub, email: data.claims.email as string | undefined }
})

export const fetchLocale = createServerFn({ method: 'GET' }).handler(async () => {
  return getCookie('lang') === 'ar' ? 'ar' : 'fr'
})
