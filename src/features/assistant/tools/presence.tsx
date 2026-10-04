import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, hhmm, todayIso } from '#/lib/format'
import { TimeField } from '#/components/TimeField'
import { membersQuery } from '#/features/team/api'
import { fetchExpected } from '#/features/attendance/StaffPresence'
import { tokens } from '#/theme/theme'
import { matchOne, normDate, normTime } from '../resolve'
import { DoneCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  teacher: z.string().describe('Le professeur (nom tel que dans le contexte)'),
  date: z.string().optional().describe("AAAA-MM-JJ ; aujourd'hui si non précisé"),
  arrived: z.string().optional().describe("Heure d'arrivée HH:MM"),
  left: z.string().optional().describe('Heure de départ HH:MM'),
  absent: z.boolean().optional().describe('Absent toute la journée'),
  justified: z.boolean().optional().describe('Absence ou retard justifié (prévenu, certificat…)'),
  note: z.string().optional().describe("Seulement le motif ou la remarque que l'utilisateur a donné (« malade », « RDV médical »). Sinon, ne rien mettre."),
})
type Args = z.infer<typeof parameters>

// "Mme Alami est arrivée à 8h40", "M. Tazi est absent aujourd'hui, malade":
// the teacher's presence line of that day, pre-filled and merged with what
// was already recorded; the user checks and saves.
export function TeacherPresenceTool() {
  useHumanInTheLoop({
    name: 'recordTeacherPresence',
    description:
      "Noter l'arrivée, le départ ou l'absence d'un professeur (Présences › Professeurs) : ouvre la fiche pré-remplie dans le chat, l'utilisateur vérifie et enregistre.",
    parameters,
    render: PresenceCard,
  })
  return null
}

function PresenceCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t } = useI18n()
  const settle = useSettle(props.respond)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; name?: string }>(props.result)
    return <DoneCard ok={r?.status === 'saved'} label={t('assistant.done.presence', { name: r?.name ?? '' })} action={<OpenButton to="/attendance" search={{ tab: 'teachers' }} />} />
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  return <PresenceForm args={props.args as Args} onDone={(name) => settle({ status: 'saved', name })} onCancel={() => settle({ status: 'cancelled' })} />
}

type Row = { id: string; arrived_at: string | null; left_at: string | null; absent: boolean; justified: boolean; note: string | null }

function PresenceForm({ args, onDone, onCancel }: { args: Args; onDone: (name: string) => void; onCancel: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery(ctx.school.id))
  const teachers = useMemo(() => (members.data ?? []).filter((m) => m.role === 'teacher' && m.status === 'active'), [members.data])
  const match = useMemo(() => matchOne(teachers, (m) => m.user?.full_name ?? '', args.teacher), [teachers, args.teacher])
  const day = normDate(args.date) ?? todayIso()
  const teacher = match.item
  // What was already recorded that day, and the expected hours
  const existing = useQuery({
    queryKey: ['school', ctx.school.id, 'presence-of', teacher?.id, day],
    enabled: !!teacher,
    queryFn: async () => {
      const row = must(
        await supabase.from('staff_presence').select('id, arrived_at, left_at, absent, justified, note').eq('member_id', teacher!.id).eq('day', day).maybeSingle(),
      ) as Row | null
      const expected = await fetchExpected(ctx.school.id, ctx.school.settings, teacher!, day)
      return { row, expected }
    },
  })

  if (members.isPending || (teacher && existing.isPending)) return <PendingCard label={t('assistant.preparing')} />
  if (!teacher)
    return (
      <Alert severity="warning" action={<Button color="inherit" size="small" onClick={onCancel}>{t('common.cancel')}</Button>}>
        {match.candidates.length
          ? t('assistant.teacherAmbiguous', { name: args.teacher, list: match.candidates.map((m) => m.user?.full_name).join(', ') })
          : t('assistant.teacherNotFound', { name: args.teacher })}
      </Alert>
    )
  return (
    <PresenceFields
      key={teacher.id + day}
      name={teacher.user?.full_name ?? ''}
      day={day}
      dayLabel={formatDate(day, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
      row={existing.data?.row ?? null}
      expected={existing.data?.expected ?? { start: null, end: null }}
      args={args}
      onSave={async (v) => {
        must(
          await supabase.from('staff_presence').upsert(
            {
              school_id: ctx.school.id,
              member_id: teacher.id,
              day,
              arrived_at: v.absent ? null : v.arrived || null,
              left_at: v.absent ? null : v.left || null,
              absent: v.absent,
              justified: v.justified,
              note: v.note.trim() || null,
              expected_start: existing.data?.expected.start ?? null,
              expected_end: existing.data?.expected.end ?? null,
              recorded_by_member_id: ctx.member.id,
            },
            { onConflict: 'member_id,day' },
          ),
        )
        await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
        onDone(teacher.user?.full_name ?? '')
      }}
      onCancel={onCancel}
    />
  )
}

function PresenceFields({
  name,
  dayLabel,
  row,
  expected,
  args,
  onSave,
  onCancel,
}: {
  name: string
  day: string
  dayLabel: string
  row: Row | null
  expected: { start: string | null; end: string | null }
  args: Args
  onSave: (v: { arrived: string; left: string; absent: boolean; justified: boolean; note: string }) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useI18n()
  // What the request says wins; else what was recorded; else nothing
  const [arrived, setArrived] = useState(normTime(args.arrived) ?? hhmm(row?.arrived_at))
  const [left, setLeft] = useState(normTime(args.left) ?? hhmm(row?.left_at))
  const [absent, setAbsent] = useState(args.absent ?? row?.absent ?? false)
  const [justified, setJustified] = useState(args.justified ?? row?.justified ?? false)
  const [note, setNote] = useState(args.note ?? row?.note ?? '')
  const save = useMutation({ mutationFn: () => onSave({ arrived, left, absent, justified, note }) })
  return (
    <Box sx={{ p: 1.5, borderRadius: 3, border: `1px solid ${tokens.line}`, bgcolor: tokens.card }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{name}</Typography>
      <Typography sx={{ fontSize: 12, color: tokens.inkMuted, mb: 1.25 }}>
        {dayLabel}
        {expected.start ? ` · ${t('assistant.presenceExpected', { start: expected.start, end: expected.end ?? '' })}` : ''}
      </Typography>
      <Stack spacing={1.25}>
        <FormControlLabel control={<Checkbox size="small" checked={absent} onChange={(e) => setAbsent(e.target.checked)} />} label={t('presence.absent')} sx={{ m: 0 }} />
        {!absent && (
          <Stack direction="row" spacing={1}>
            <TimeField size="small" label={t('presence.arrival')} value={arrived} onChange={setArrived} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
            <TimeField size="small" label={t('presence.departure')} value={left} onChange={setLeft} sx={{ flex: 1 }} slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
        )}
        <FormControlLabel control={<Checkbox size="small" checked={justified} onChange={(e) => setJustified(e.target.checked)} />} label={t('abs.justifiedF')} sx={{ m: 0 }} />
        <TextField size="small" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('presence.notePlaceholder')} />
        {row && <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>{t('assistant.presenceUpdates')}</Typography>}
        {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="contained" loading={save.isPending} disabled={!absent && !arrived && !left} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
