import { createContext, useContext, useSyncExternalStore } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { supabase } from './supabase/client'
import { must } from './errors'

export type Role = 'admin' | 'staff' | 'teacher' | 'parent' | 'student'
export const ROLE_PRIORITY: Role[] = ['admin', 'staff', 'teacher', 'parent', 'student']

export type Membership = {
  id: string
  role: Role
  school_id: string
  school: { id: string; name: string; slug: string; settings: Record<string, unknown> }
}

export type SessionData = {
  user: { id: string; full_name: string; email: string | null; locale: string }
  memberships: Membership[]
}

export const sessionQuery = (sub: string) =>
  queryOptions({
    queryKey: ['session', sub],
    queryFn: async (): Promise<SessionData | null> => {
      const user = must(
        await supabase
          .from('users')
          .select('id, full_name, email, locale')
          .eq('auth_provider_id', sub)
          .maybeSingle(),
      )
      if (!user) return null
      const rows = must(
        await supabase
          .from('school_members')
          .select('id, role, school_id, school:schools(id, name, slug, settings)')
          .eq('user_id', user.id)
          .eq('status', 'active'),
      )
      return {
        user,
        memberships: (rows as unknown as Membership[]).filter((m) => m.school),
      }
    },
  })

export const currentYearQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'current-year'],
    queryFn: async () =>
      must(
        await supabase
          .from('academic_years')
          .select('id, name, starts_on, ends_on, is_current')
          .eq('school_id', schoolId)
          .eq('is_current', true)
          .maybeSingle(),
      ),
  })

const LS_SCHOOL = 'sage.school'
const lsRole = (schoolId: string) => `sage.role.${schoolId}`

function lsGet(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: selection just isn't remembered */
  }
}

// Picks the active school and role: last choice, else the first school and
// the highest-priority role held there.
export function resolveActive(data: SessionData) {
  const schools = [...new Map(data.memberships.map((m) => [m.school_id, m.school])).values()]
  const savedSchool = lsGet(LS_SCHOOL)
  const school = schools.find((s) => s.id === savedSchool) ?? schools[0] ?? null
  if (!school) return { schools, school: null, member: null, roles: [] as Role[] }
  const here = data.memberships.filter((m) => m.school_id === school.id)
  const roles = ROLE_PRIORITY.filter((r) => here.some((m) => m.role === r))
  const savedRole = lsGet(lsRole(school.id)) as Role | null
  const role = savedRole && roles.includes(savedRole) ? savedRole : roles[0]
  const member = here.find((m) => m.role === role)!
  return { schools, school, member, roles }
}

// The active school/role lives in localStorage, which React can't observe.
// A version counter makes every change re-render the layout: the session
// data itself doesn't change when switching, so a memo keyed on it alone
// would keep the previous school.
let selectionVersion = 0
const listeners = new Set<() => void>()
function bumpSelection() {
  selectionVersion++
  for (const l of listeners) l()
}
export function useSelectionVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => selectionVersion,
    () => 0,
  )
}

export function rememberSchool(schoolId: string) {
  lsSet(LS_SCHOOL, schoolId)
  bumpSelection()
}
export function rememberRole(schoolId: string, role: Role) {
  lsSet(lsRole(schoolId), role)
  bumpSelection()
}

export type SchoolCtx = {
  sub: string
  user: SessionData['user']
  schools: Membership['school'][]
  school: Membership['school']
  member: Membership
  role: Role
  roles: Role[]
  year: { id: string; name: string; starts_on: string; ends_on: string } | null
  isOffice: boolean
  isAdmin: boolean
}

export const SchoolContext = createContext<SchoolCtx | null>(null)

export function useSchool() {
  const ctx = useContext(SchoolContext)
  if (!ctx) throw new Error('useSchool outside SchoolContext')
  return ctx
}

export function useCurrentYear(schoolId: string) {
  return useQuery(currentYearQuery(schoolId))
}
