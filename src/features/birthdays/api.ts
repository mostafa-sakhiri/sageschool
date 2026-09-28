import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { addDays, mondayOf } from '#/lib/format'
import type { StudentRow } from '#/features/students/api'

export type BirthdayStatus = 'to_organize' | 'not_organizing' | 'organized'
export const BIRTHDAY_STATUSES: BirthdayStatus[] = ['to_organize', 'not_organizing', 'organized']

export type Birthday = {
  student: StudentRow
  date: string // the day it falls on, ISO
  year: number
  age: number
  status: BirthdayStatus
}

// Status per birthday, keyed `${student_id}:${year}`. No row = to organize.
export const birthdayPlansQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'birthday-plans'],
    queryFn: async () =>
      Object.fromEntries(
        must(await supabase.from('birthday_plans').select('student_id, year, status').eq('school_id', schoolId)).map((p) => [
          `${p.student_id}:${p.year}`,
          p.status as BirthdayStatus,
        ]),
      ) as Record<string, BirthdayStatus>,
  })

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

// Active students' birthdays between two ISO days (both included), soonest
// first. Born on 29 February: celebrated on the 28th in other years.
export function birthdaysBetween(students: StudentRow[], from: string, to: string, plans: Record<string, BirthdayStatus>): Birthday[] {
  const years = [Number(from.slice(0, 4)), Number(to.slice(0, 4))].filter((y, i, a) => a.indexOf(y) === i)
  const out: Birthday[] = []
  for (const s of students) {
    if (s.status !== 'active' || !s.birth_date) continue
    const born = Number(s.birth_date.slice(0, 4))
    const md = s.birth_date.slice(5)
    for (const y of years) {
      const date = `${y}-${md === '02-29' && !leap(y) ? '02-28' : md}`
      if (date < from || date > to || y <= born) continue
      out.push({ student: s, date, year: y, age: y - born, status: plans[`${s.id}:${y}`] ?? 'to_organize' })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.student.last_name.localeCompare(b.student.last_name))
}

// This week and next, Monday to Sunday: what the office has to deal with.
// Days already past this week stay until a status is chosen.
export const twoWeeks = (today: string) => [mondayOf(today), addDays(mondayOf(today), 13)] as const
