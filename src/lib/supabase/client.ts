import type { Database } from '../database.types'
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // createBrowserClient is a singleton: safe to call anywhere.
  return createBrowserClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  )
}

export const supabase = createClient()
