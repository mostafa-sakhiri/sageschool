import { useMemo } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { fullName } from '#/components/ui'
import { studentsQuery } from '#/features/students/api'
import { AppointmentDialog, KINDS, plusMinutes, toIso, type Appointment } from '#/features/agenda/AppointmentDialog'
import { formatDate } from '#/lib/format'
import { matchOne, normDate, normTime } from '../resolve'
import { DoneCard, FormCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  kind: z
    .enum(KINDS)
    .describe(
      "visit_parent: un parent d'élève vient ; visit_student: un élève convoqué ; visit_prospect: une famille pas encore inscrite visite l'école ; enrollment: rendez-vous d'inscription ; meeting: réunion ; other",
    ),
  date: z.string().describe('AAAA-MM-JJ'),
  startTime: z.string().describe('HH:MM'),
  endTime: z.string().optional().describe('HH:MM ; 30 minutes après le début si non précisé'),
  title: z.string().optional(),
  visitorName: z.string().optional().describe('La personne attendue'),
  visitorPhone: z.string().optional(),
  studentName: z.string().optional().describe("L'élève concerné (prénom et nom), si c'est un élève de l'école"),
  notes: z.string().optional(),
})
type Args = z.infer<typeof parameters>

// A3: "RDV avec la maman d'Adam Bennani samedi à 10h"
export function AppointmentTool() {
  useHumanInTheLoop({
    name: 'scheduleAppointment',
    description: "Planifier un rendez-vous dans l'agenda de l'école : ouvre la fiche pré-remplie dans le chat, l'utilisateur vérifie et enregistre.",
    parameters,
    render: AppointmentCard,
  })
  return null
}

function AppointmentCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t, locale } = useI18n()
  const settle = useSettle(props.respond)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; date?: string; time?: string }>(props.result)
    return (
      <DoneCard
        ok={r?.status === 'saved'}
        label={t('assistant.done.appointment', { date: r?.date ? formatDate(r.date, locale, { weekday: 'long', day: 'numeric', month: 'long' }) : '', time: r?.time ?? '' })}
        action={
          <OpenButton to="/agenda" />
        }
      />
    )
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  const a = props.args as Args
  return (
    <AppointmentForm
      args={a}
      onSaved={() => settle({ status: 'saved', date: normDate(a.date), time: normTime(a.startTime) })}
      onCancel={() => settle({ status: 'cancelled' })}
    />
  )
}

function AppointmentForm({ args, onSaved, onCancel }: { args: Args; onSaved: () => void; onCancel: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const students = useQuery({ ...studentsQuery(ctx.school.id), enabled: !!args.studentName })
  const student = useMemo(() => matchOne(students.data ?? [], (s) => fullName(s), args.studentName), [students.data, args.studentName])
  const date = normDate(args.date)
  const start = normTime(args.startTime)
  const end = normTime(args.endTime) ?? (start ? plusMinutes(start, 30) : null)
  const initial = useMemo<Partial<Appointment> | null>(
    () =>
      args.studentName && students.isPending
        ? null
        : {
            kind: args.kind,
            title: args.title ?? '',
            starts_at: date && start ? toIso(date, start) : undefined,
            ends_at: date && end ? toIso(date, end) : undefined,
            visitor_name: args.visitorName ?? null,
            visitor_phone: args.visitorPhone ?? null,
            student_id: student.item?.id ?? null,
            notes: args.notes ?? null,
          },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the arguments are final once the card executes
    [students.isPending, student.item?.id],
  )
  if (!initial) return <PendingCard label={t('assistant.preparing')} />
  return (
    <FormCard
      notes={[
        args.studentName && !student.item ? t('assistant.studentNotFound', { name: args.studentName }) : null,
        !date || !start ? t('assistant.dateUnreadable', { value: `${args.date} ${args.startTime}` }) : null,
      ]}
    >
      <AppointmentDialog initial={initial} onClose={onCancel} onSaved={onSaved} />
    </FormCard>
  )
}
