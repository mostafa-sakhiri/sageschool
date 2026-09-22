import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import type { Tone } from '#/components/ui'

// Queries shared by several pages (kept out of route files so route code
// splitting stays intact).

export type Announcement = {
  id: string
  title: string
  body: string
  priority: 'normal' | 'important' | 'urgent'
  status: 'draft' | 'published'
  published_at: string | null
  created_at: string
  targets: { class_id: string | null; node_id: string | null }[]
}

export const announcementsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'announcements'],
    queryFn: async () =>
      must(
        await supabase
          .from('announcements')
          .select('id, title, body, priority, status, published_at, created_at, targets:announcement_targets(class_id, node_id)')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false }),
      ) as unknown as Announcement[],
  })

export type CaseRow = {
  id: string
  subject: string
  status: 'open' | 'answered' | 'resolved'
  direction: 'parent_to_school' | 'school_to_parent'
  student_id: string | null
  parent_member_id: string
  updated_at: string
  parent: { user: { full_name: string } | null } | null
  student: { first_name: string; last_name: string } | null
}

export const CASE_TONE: Record<CaseRow['status'], Tone> = { open: 'warn', answered: 'info', resolved: 'ok' }

export const casesQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'cases'],
    queryFn: async () =>
      must(
        await supabase
          .from('cases')
          .select(
            'id, subject, status, direction, student_id, parent_member_id, updated_at, parent:school_members!cases_parent_member_id_school_id_parent_role_fkey(user:users(full_name)), student:students(first_name, last_name)',
          )
          .eq('school_id', schoolId)
          .order('updated_at', { ascending: false }),
      ) as unknown as CaseRow[],
  })

export type Balance = {
  id: string
  student_id: string
  label: string
  due_on: string
  amount_due: number
  amount_paid: number
  amount_remaining: number
  payment_status: 'paid' | 'partial' | 'pending' | 'overdue' | 'cancelled'
}

export const balancesQuery = (schoolId: string, yearId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'balances', yearId],
    queryFn: async () =>
      must(
        await supabase
          .from('installment_balances')
          .select('id, student_id, label, due_on, amount_due, amount_paid, amount_remaining, payment_status')
          .eq('academic_year_id', yearId)
          .order('due_on'),
      ) as Balance[],
  })

export type Hw = {
  id: string
  class_id: string
  subject_id: string | null
  title: string
  body: string
  assigned_on: string
  due_on: string | null
  class: { name: string } | null
}

export const homeworkQuery = (schoolId: string) => ({
  queryKey: ['school', schoolId, 'homework'],
  queryFn: async () =>
    must(
      await supabase
        .from('homework')
        .select('id, class_id, subject_id, title, body, assigned_on, due_on, class:classes(name)')
        .eq('school_id', schoolId)
        .order('due_on', { ascending: true, nullsFirst: false })
        .limit(100),
    ) as unknown as Hw[],
})
