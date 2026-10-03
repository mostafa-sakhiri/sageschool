import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import type { Permission, Role } from '#/lib/session'

export type MemberRow = {
  id: string
  role: Role
  is_assistant: boolean
  status: 'active' | 'inactive'
  custom_role: { id: string; name: string } | null
  user: { id: string; full_name: string; email: string | null; phone: string | null } | null
}

export const membersQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'members'],
    queryFn: async () =>
      must(
        await supabase
          .from('school_members')
          .select('id, role, is_assistant, status, custom_role:school_roles(id, name), user:users(id, full_name, email, phone)')
          .eq('school_id', schoolId)
          .order('created_at'),
      ) as unknown as MemberRow[],
  })

// The school's roles: the built-in secrétariat and professeur (builtin_key,
// no name of their own) and those the school created (name, base_role)
export type SchoolRole = {
  id: string
  builtin_key: 'staff' | 'teacher' | null
  name: string | null
  base_role: 'staff' | 'teacher'
  permissions: Permission[]
}
export const rolesQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'roles'],
    queryFn: async () =>
      must(
        await supabase
          .from('school_roles')
          .select('id, builtin_key, name, base_role, permissions')
          .eq('school_id', schoolId)
          .order('builtin_key', { nullsFirst: false })
          .order('name'),
      ) as unknown as SchoolRole[],
  })
