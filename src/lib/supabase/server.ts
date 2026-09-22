import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCookies, setCookie } from '@tanstack/react-start/server'

// Request-scoped client: reads and refreshes the session cookie.
export function createClient() {
  return createServerClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({ name, value }))
        },
        setAll(cookies) {
          for (const { name, value, options } of cookies) setCookie(name, value, options)
        },
      },
    },
  )
}

// Secret-key client: bypasses RLS. Only for vetted server functions that have
// already authorized the caller (team invitations, student logins).
export function createServiceClient() {
  return createAdminClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
