import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import type { Role } from '#/lib/session'

export type MemberRow = {
  id: string
  role: Role
  status: 'active' | 'inactive'
  user: { id: string; full_name: string; email: string | null; phone: string | null } | null
}

export const membersQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'members'],
    queryFn: async () =>
      must(
        await supabase
          .from('school_members')
          .select('id, role, status, user:users(id, full_name, email, phone)')
          .eq('school_id', schoolId)
          .order('created_at'),
      ) as unknown as MemberRow[],
  })
