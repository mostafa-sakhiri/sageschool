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

// For each class of a year: how many of its subjects have a teacher.
// Keyed under 'assignments' so saving an assignment refreshes it.
export const teacherCoverageQuery = (schoolId: string, classIds: string[]) =>
  queryOptions({
    queryKey: ['school', schoolId, 'assignments', 'coverage', classIds.join()],
    enabled: classIds.length > 0,
    queryFn: async () => {
      const [hours, assigned] = await Promise.all([
        supabase.from('class_required_hours').select('class_id, subject_id').in('class_id', classIds),
        supabase.from('teaching_assignments').select('class_id, subject_id').in('class_id', classIds),
      ])
      const has = new Set(must(assigned).map((a) => `${a.class_id}|${a.subject_id}`))
      const out: Record<string, { total: number; done: number }> = {}
      for (const h of must(hours)) {
        if (!h.class_id || !h.subject_id) continue
        const c = (out[h.class_id] ??= { total: 0, done: 0 })
        c.total++
        if (has.has(`${h.class_id}|${h.subject_id}`)) c.done++
      }
      return out
    },
  })

// One teacher for every subject of a class (its titulaire), or any set of
// class × subject: what was assigned there is replaced. `teacherId` '' clears.
export async function assignTeacher(schoolId: string, pairs: { classId: string; subjectId: string }[], teacherId: string) {
  if (!pairs.length) return
  const classIds = [...new Set(pairs.map((p) => p.classId))]
  const existing = must(await supabase.from('teaching_assignments').select('id, class_id, subject_id').in('class_id', classIds))
  const doomed = existing.filter((a) => pairs.some((p) => p.classId === a.class_id && p.subjectId === a.subject_id)).map((a) => a.id)
  if (doomed.length) must(await supabase.from('teaching_assignments').delete().in('id', doomed))
  if (teacherId)
    must(
      await supabase
        .from('teaching_assignments')
        .insert(pairs.map((p) => ({ school_id: schoolId, class_id: p.classId, subject_id: p.subjectId, teacher_member_id: teacherId }))),
    )
}

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
