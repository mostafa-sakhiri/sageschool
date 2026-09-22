import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'

export type Guardian = {
  guardian_member_id: string
  relationship: 'mother' | 'father' | 'guardian' | 'other' | null
  is_primary: boolean
  is_payer: boolean
  member: { id: string; user: { full_name: string; email: string | null; phone: string | null } | null } | null
}

export type StudentRow = {
  id: string
  first_name: string
  last_name: string
  birth_date: string | null
  gender: 'female' | 'male' | null
  status: string
  member_id: string | null
  enrollments: { id: string; class_id: string; academic_year_id: string; status: string; class: { name: string } | null }[]
  guardians: Guardian[]
}

export const studentsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'students'],
    queryFn: async () =>
      must(
        await supabase
          .from('students')
          .select(
            `id, first_name, last_name, birth_date, gender, status, member_id,
             enrollments(id, class_id, academic_year_id, status, class:classes(name)),
             guardians:student_guardians(guardian_member_id, relationship, is_primary, is_payer,
               member:school_members(id, user:users(full_name, email, phone)))`,
          )
          .eq('school_id', schoolId)
          .order('last_name')
          .order('first_name'),
      ) as unknown as StudentRow[],
  })

export const parentsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'parents'],
    queryFn: async () =>
      (
        must(
          await supabase
            .from('school_members')
            .select('id, user:users(full_name, email)')
            .eq('school_id', schoolId)
            .eq('role', 'parent'),
        ) as unknown as { id: string; user: { full_name: string; email: string | null } | null }[]
      ).sort((a, b) => (a.user?.full_name ?? '').localeCompare(b.user?.full_name ?? '')),
  })

export function currentEnrollment(s: StudentRow, yearId: string | undefined) {
  return s.enrollments.find((e) => e.academic_year_id === yearId && e.status === 'active')
}
