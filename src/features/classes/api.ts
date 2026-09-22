import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'

export type ClassRow = {
  id: string
  name: string
  node_id: string
  capacity: number | null
  home_room_id: string | null
  enrollments: { count: number }[]
}

export const classesQuery = (schoolId: string, yearId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'classes', yearId],
    queryFn: async () =>
      must(
        await supabase
          .from('classes')
          .select('id, name, node_id, capacity, home_room_id, enrollments(count)')
          .eq('academic_year_id', yearId)
          .order('name'),
      ) as unknown as ClassRow[],
  })

export const requiredHoursQuery = (schoolId: string, classId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'class-hours', classId],
    queryFn: async () =>
      must(
        await supabase
          .from('class_required_hours')
          .select('subject_id, weekly_minutes, min_session_minutes, max_session_minutes')
          .eq('class_id', classId),
      ),
  })

export const assignmentsQuery = (schoolId: string, classId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'assignments', classId],
    queryFn: async () =>
      must(
        await supabase
          .from('teaching_assignments')
          .select('id, subject_id, teacher_member_id, kind, valid_from, valid_to')
          .eq('class_id', classId),
      ),
  })

export const teachersQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'teachers'],
    queryFn: async () =>
      (
        must(
          await supabase
            .from('school_members')
            .select('id, user:users(full_name)')
            .eq('school_id', schoolId)
            .eq('role', 'teacher')
            .eq('status', 'active'),
        ) as unknown as { id: string; user: { full_name: string } | null }[]
      )
        .map((m) => ({ id: m.id, name: m.user?.full_name ?? '—' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
  })
