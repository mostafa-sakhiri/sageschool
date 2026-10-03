import { createContext, useContext, useSyncExternalStore } from 'react'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from './supabase/client'
import { must } from './errors'

export type Role = 'admin' | 'staff' | 'teacher' | 'parent' | 'student'
export const ROLE_PRIORITY: Role[] = ['admin', 'staff', 'teacher', 'parent', 'student']
// What the office picks for a staff member: an assistant is a teacher
// membership marked is_assistant (same rights, see DECISIONS.md).
export type StaffRole = 'teacher' | 'assistant' | 'staff' | 'admin'
export const STAFF_ROLES: StaffRole[] = ['teacher', 'assistant', 'staff', 'admin']
export const staffRoleOf = (m: { role: Role; is_assistant?: boolean | null }): Role | 'assistant' =>
  m.role === 'teacher' && m.is_assistant ? 'assistant' : m.role

export type Membership = {
  id: string
  role: Role
  school_id: string
  // A role created by the school, built on `role` (Réglages › Accès et rôles)
  custom_role: { id: string; name: string } | null
  school: { id: string; name: string; slug: string; settings: Record<string, unknown> }
}

export type SessionData = {
  user: { id: string; full_name: string; email: string | null; phone: string | null; locale: string }
  memberships: Membership[]
}

export const sessionQuery = (sub: string) =>
  queryOptions({
    queryKey: ['session', sub],
    queryFn: async (): Promise<SessionData | null> => {
      const user = must(
        await supabase
          .from('users')
          .select('id, full_name, email, phone, locale')
          .eq('auth_provider_id', sub)
          .maybeSingle(),
      )
      if (!user) return null
      const rows = must(
        await supabase
          .from('school_members')
          .select('id, role, school_id, custom_role:school_roles(id, name), school:schools(id, name, slug, settings)')
          .eq('user_id', user.id)
          .eq('status', 'active'),
      )
      return {
        user,
        memberships: (rows as unknown as Membership[]).filter((m) => m.school),
      }
    },
  })

// Permissions: one explicit action each, grouped as the Rôles page shows
// them. Mirrors private.permission_keys() in the database, which enforces
// them. `needs`: turning one on turns these on (you can't collect a payment
// you can't see).
export const PERMISSION_GROUPS = [
  { key: 'students', permissions: ['students.view', 'students.create', 'students.edit', 'students.families', 'students.delete'] },
  { key: 'attendance', permissions: ['attendance.take_own', 'attendance.view_all', 'attendance.take_all', 'attendance.alerts'] },
  { key: 'staff_presence', permissions: ['staff_presence.view', 'staff_presence.record'] },
  { key: 'preregistrations', permissions: ['preregistrations.view', 'preregistrations.manage'] },
  { key: 'agenda', permissions: ['agenda.view', 'agenda.manage'] },
  { key: 'events', permissions: ['events.birthdays', 'events.manage'] },
  { key: 'announcements', permissions: ['announcements.view_all', 'announcements.create', 'announcements.publish', 'announcements.edit_all'] },
  { key: 'messages', permissions: ['messages.view', 'messages.reply'] },
  { key: 'fees', permissions: ['fees.view', 'fees.collect', 'fees.remind', 'fees.plans'] },
  { key: 'timetable', permissions: ['timetable.view_all', 'timetable.exceptions'] },
  { key: 'classes', permissions: ['classes.view_all'] },
  { key: 'homework', permissions: ['homework.own'] },
] as const
export type Permission = (typeof PERMISSION_GROUPS)[number]['permissions'][number]
export const PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions) as Permission[]
export const PERMISSION_NEEDS: Partial<Record<Permission, Permission[]>> = {
  'students.create': ['students.view'],
  'students.edit': ['students.view'],
  'students.families': ['students.view'],
  'students.delete': ['students.view'],
  'attendance.take_all': ['attendance.view_all'],
  'attendance.alerts': ['attendance.view_all'],
  'staff_presence.record': ['staff_presence.view'],
  'preregistrations.manage': ['preregistrations.view'],
  'agenda.manage': ['agenda.view'],
  'events.manage': ['events.birthdays'],
  'announcements.publish': ['announcements.create', 'announcements.view_all'],
  'announcements.edit_all': ['announcements.view_all'],
  'messages.reply': ['messages.view'],
  'fees.collect': ['fees.view'],
  'fees.remind': ['fees.view'],
  'fees.plans': ['fees.view'],
  'timetable.exceptions': ['timetable.view_all'],
}

// What the active membership may do, as the database computes it
export const permissionsQuery = (sub: string, memberId: string) =>
  queryOptions({
    queryKey: ['session', sub, 'permissions', memberId],
    queryFn: async () => (must(await supabase.rpc('member_permissions', { p_member_id: memberId })) ?? []) as Permission[],
  })

export type SchoolYear = { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }

// All years of a school, newest first (shared key with the settings page).
export const schoolYearsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'years'],
    queryFn: async () =>
      must(
        await supabase
          .from('academic_years')
          .select('id, name, starts_on, ends_on, is_current')
          .eq('school_id', schoolId)
          .order('starts_on', { ascending: false }),
      ) as SchoolYear[],
  })

const LS_SCHOOL = 'sage.school'
const lsRole = (schoolId: string) => `sage.role.${schoolId}`
const lsYear = (schoolId: string) => `sage.year.${schoolId}`

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
// The year being viewed is a per-user choice; the school's official current
// year (is_current) is only changed from Settings.
export function rememberYear(schoolId: string, yearId: string) {
  lsSet(lsYear(schoolId), yearId)
  bumpSelection()
}
export function resolveYear(schoolId: string, years: SchoolYear[]) {
  const saved = lsGet(lsYear(schoolId))
  return years.find((y) => y.id === saved) ?? years.find((y) => y.is_current) ?? years[0] ?? null
}

export type SchoolCtx = {
  sub: string
  user: SessionData['user']
  schools: Membership['school'][]
  school: Membership['school']
  member: Membership
  role: Role
  roles: Role[]
  year: SchoolYear | null
  years: SchoolYear[]
  // Admin or secrétariat (built-in or a role built on it): the office's
  // dashboard and pages. A teacher's role keeps the teacher's.
  isOffice: boolean
  isAdmin: boolean
  permissions: Permission[]
  can: (permission: Permission) => boolean
  // Scolarité visible (fees.view)
  canFees: boolean
}

export const SchoolContext = createContext<SchoolCtx | null>(null)

export function useSchool() {
  const ctx = useContext(SchoolContext)
  if (!ctx) throw new Error('useSchool outside SchoolContext')
  return ctx
}

