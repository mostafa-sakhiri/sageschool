import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { addDays, todayIso } from '#/lib/format'
import type { Tone } from '#/components/ui'

export const STATUSES = ['new', 'contacted', 'visit_planned', 'waiting', 'enrolled', 'dropped'] as const
export type Status = (typeof STATUSES)[number]
export const ACTIVE: Status[] = ['new', 'contacted', 'visit_planned', 'waiting']
export const TONE: Record<Status, Tone> = { new: 'warn', contacted: 'info', visit_planned: 'info', waiting: 'neutral', enrolled: 'ok', dropped: 'neutral' }
export const CHANNELS = ['phone', 'whatsapp', 'email', 'in_person', 'other'] as const
// Without a planned date, a fiche is due for a follow-up this many days after the last one
export const FOLLOWUP_EVERY = 7

export type Prereg = {
  id: string
  academic_year_id: string | null
  node_id: string | null
  child_first_name: string
  child_last_name: string
  birth_date: string | null
  parent_name: string
  parent_phone: string | null
  parent_email: string | null
  source: string | null
  notes: string | null
  status: Status
  last_followup_at: string | null
  followup_count: number
  next_followup_on: string | null
  student_id: string | null
  created_at: string
}

export const preregsQuery = (schoolId: string) => ({
  queryKey: ['school', schoolId, 'preinscriptions'],
  queryFn: async () =>
    must(
      await supabase
        .from('preinscriptions')
        .select(
          'id, academic_year_id, node_id, child_first_name, child_last_name, birth_date, parent_name, parent_phone, parent_email, source, notes, status, last_followup_at, followup_count, next_followup_on, student_id, created_at',
        )
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false }),
    ) as Prereg[],
})

// Due for a follow-up: planned date reached, or never / not recently contacted
export function followupDue(p: Prereg, today = todayIso()) {
  if (!ACTIVE.includes(p.status)) return false
  if (p.next_followup_on) return p.next_followup_on <= today
  if (!p.last_followup_at) return true
  return p.last_followup_at.slice(0, 10) <= addDays(today, -FOLLOWUP_EVERY)
}

