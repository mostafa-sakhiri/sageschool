import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'

export type StudentAlert = {
  id: string
  student_id: string
  kind: 'absence_streak' | 'manual'
  title: string | null
  note: string | null
  starts_on: string
  ends_on: string | null
  days: number | null
  status: 'open' | 'notified' | 'closed'
  notified_at: string | null
  created_at: string
  notified_by: { user: { full_name: string } | null } | null
}

export const alertsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'alerts'],
    queryFn: async () =>
      must(
        await supabase
          .from('student_alerts')
          .select(
            'id, student_id, kind, title, note, starts_on, ends_on, days, status, notified_at, created_at, notified_by:school_members!student_alerts_notified_by_member_id_fkey(user:users(full_name))',
          )
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(300),
      ) as unknown as StudentAlert[],
  })
