import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { addDays } from '#/lib/format'

export type Version = {
  id: string
  name: string
  kind: 'base' | 'seasonal'
  status: 'draft' | 'published' | 'archived'
  effective_from: string
  effective_to: string | null
  published_at: string | null
}

export type Slot = {
  id: string
  version_id: string
  subject_id: string | null
  teacher_member_id: string | null
  room_id: string | null
  title: string | null
  weekday: number
  starts_at: string
  ends_at: string
}

export type DaySession = {
  slot_id: string | null
  exception_id: string | null
  status: 'scheduled' | 'cancelled' | 'changed' | 'added' | 'day_off'
  subject_id: string | null
  teacher_member_id: string | null
  room_id: string | null
  title: string | null
  starts_at: string | null
  ends_at: string | null
  reason_code: string | null
  reason: string | null
}

export const versionsQuery = (schoolId: string, classId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'tt-versions', classId],
    queryFn: async () =>
      must(
        await supabase
          .from('timetable_versions')
          .select('id, name, kind, status, effective_from, effective_to, published_at')
          .eq('class_id', classId)
          .order('effective_from', { ascending: false })
          .order('created_at', { ascending: false }),
      ) as Version[],
  })

export const slotsQuery = (schoolId: string, versionId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'tt-slots', versionId],
    queryFn: async () =>
      must(
        await supabase
          .from('timetable_slots')
          .select('id, version_id, subject_id, teacher_member_id, room_id, title, weekday, starts_at, ends_at')
          .eq('version_id', versionId)
          .order('weekday')
          .order('starts_at'),
      ) as Slot[],
  })

// The real week of a class: published trame + dated exceptions, one RPC per day.
export const classWeekQuery = (schoolId: string, classId: string, monday: string, days: number[]) =>
  queryOptions({
    queryKey: ['school', schoolId, 'tt-week', classId, monday, days.join()],
    queryFn: async () => {
      const out: Record<number, DaySession[]> = {}
      await Promise.all(
        days.map(async (d) => {
          out[d] = must(
            await supabase.rpc('timetable_day', { p_class_id: classId, p_date: addDays(monday, d - 1) }),
          ) as DaySession[]
        }),
      )
      return out
    },
  })

export type TeacherSession = DaySession & { class_id: string }

export const teacherWeekQuery = (schoolId: string, memberId: string, monday: string, days: number[]) =>
  queryOptions({
    queryKey: ['school', schoolId, 'tt-teacher-week', memberId, monday, days.join()],
    queryFn: async () => {
      const out: Record<number, TeacherSession[]> = {}
      await Promise.all(
        days.map(async (d) => {
          out[d] = must(
            await supabase.rpc('teacher_day', {
              p_teacher_member_id: memberId,
              p_date: addDays(monday, d - 1),
            }),
          ) as TeacherSession[]
        }),
      )
      return out
    },
  })

export const membersNamesQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'member-names'],
    queryFn: async () => {
      const rows = must(
        await supabase.from('school_members').select('id, user:users(full_name)').eq('school_id', schoolId),
      ) as unknown as { id: string; user: { full_name: string } | null }[]
      return Object.fromEntries(rows.map((r) => [r.id, r.user?.full_name ?? '—'])) as Record<string, string>
    },
  })

// Stable colour per subject (mockup palette), keyed by id.
const PALETTE = [
  { bg: '#E7EEF7', ink: '#2A4A6B' },
  { bg: '#F7E9E2', ink: '#7A4423' },
  { bg: '#F0EAF7', ink: '#57407A' },
  { bg: '#FBF0DC', ink: '#7A5210' },
  { bg: '#E4F0EC', ink: '#0A5347' },
  { bg: '#F5E6EC', ink: '#7A2F4E' },
  { bg: '#EAF1E1', ink: '#3F5A1E' },
  { bg: '#E8EEF0', ink: '#34525C' },
]
export function subjectColor(id: string | null | undefined) {
  if (!id) return { bg: '#F2EEE4', ink: '#6B655A' }
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
