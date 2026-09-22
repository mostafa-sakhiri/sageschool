import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { addDays, formatDate, hhmm, mondayOf, todayIso } from '#/lib/format'
import { roomsQuery, subjectsQuery } from '#/features/structure/api'
import { teachersQuery } from '#/features/classes/api'
import { ErrorState, Loading } from '#/components/states'
import { Tag } from '#/components/ui'
import { WeekGrid, type Block } from './WeekGrid'
import { classWeekQuery, membersNamesQuery, subjectColor, type DaySession } from './api'
import { tokens } from '#/theme/theme'

export function useSchoolDays() {
  const ctx = useSchool()
  const opening = (ctx.school.settings as { opening?: { days: string[]; day: [string, string] } }).opening
  return {
    days: (opening?.days ?? ['1', '2', '3', '4', '5']).map(Number),
    start: opening?.day?.[0] ?? '08:00',
    end: opening?.day?.[1] ?? '17:00',
  }
}

export function WeekNav({ monday, onChange }: { monday: string; onChange: (m: string) => void }) {
  const { t, locale, dir } = useI18n()
  const prev = <ChevronLeft />
  const next = <ChevronRight />
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <IconButton aria-label={t('tt.prevWeek')} onClick={() => onChange(addDays(monday, -7))}>
        {dir === 'rtl' ? next : prev}
      </IconButton>
      <Typography sx={{ fontWeight: 600, minWidth: 190, textAlign: 'center' }}>
        {t('tt.weekOf', { date: formatDate(monday, locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}
      </Typography>
      <IconButton aria-label={t('tt.nextWeek')} onClick={() => onChange(addDays(monday, 7))}>
        {dir === 'rtl' ? prev : next}
      </IconButton>
      <Button size="small" variant="outlined" onClick={() => onChange(mondayOf(todayIso()))}>
        {t('tt.today')}
      </Button>
    </Stack>
  )
}

// The class's actual week: published version + one-day exceptions. The office
// can click a session to record a teacher absence / substitute or a cancellation.
export function RealWeek({
  classId,
  allowExceptions,
  initialMonday,
}: {
  classId: string
  allowExceptions: boolean
  initialMonday?: string
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const { days, start, end } = useSchoolDays()
  const [monday, setMonday] = useState(initialMonday ?? mondayOf(ctx.year && todayIso() < ctx.year.starts_on ? ctx.year.starts_on : todayIso()))
  const week = useQuery(classWeekQuery(ctx.school.id, classId, monday, days))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const rooms = useQuery(roomsQuery(ctx.school.id))
  const names = useQuery(membersNamesQuery(ctx.school.id))
  const [picked, setPicked] = useState<{ date: string; s: DaySession } | null>(null)
  const [dayOff, setDayOff] = useState<string | null>(null)

  const subjectName = (id: string | null) => subjects.data?.find((x) => x.id === id)?.name
  const roomName = (id: string | null) => rooms.data?.find((x) => x.id === id)?.name
  const dayNames = t('setup.dayNames').split(',')

  const blocks: Block[] = []
  const notes: Record<number, string | undefined> = {}
  for (const d of days) {
    for (const s of week.data?.[d] ?? []) {
      if (s.status === 'day_off') {
        notes[d] = `${t('tt.dayOff')}${s.reason ? ` — ${s.reason}` : ''}`
        continue
      }
      if (!s.starts_at || !s.ends_at) continue
      const date = addDays(monday, d - 1)
      blocks.push({
        key: `${d}-${s.slot_id ?? s.exception_id}`,
        weekday: d,
        start: s.starts_at,
        end: s.ends_at,
        title: s.title || subjectName(s.subject_id) || '—',
        lines: [names.data?.[s.teacher_member_id ?? ''] ?? '', roomName(s.room_id) ?? ''].filter(Boolean),
        color: subjectColor(s.subject_id),
        strike: s.status === 'cancelled',
        badge:
          s.status === 'cancelled'
            ? t('tt.cancelled')
            : s.status === 'changed'
              ? t('tt.changed')
              : s.status === 'added'
                ? t('tt.added')
                : undefined,
        onClick: allowExceptions && s.slot_id && s.status === 'scheduled' ? () => setPicked({ date, s }) : undefined,
      })
    }
  }
  const labels = Object.fromEntries(
    days.map((d) => [d, `${dayNames[d - 1]} ${formatDate(addDays(monday, d - 1), locale, { day: 'numeric', month: 'short' })}`]),
  )

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <WeekNav monday={monday} onChange={setMonday} />
        {allowExceptions && (
          <TextField
            select
            size="small"
            label={t('tt.closeDay')}
            value=""
            onChange={(e) => setDayOff(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {days.map((d) => (
              <MenuItem key={d} value={addDays(monday, d - 1)}>
                {labels[d]}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>
      {allowExceptions && (
        <Typography variant="body2" color="text.secondary">
          {t('tt.exceptionHint')}
        </Typography>
      )}
      {week.isPending ? (
        <Loading rows={4} />
      ) : week.isError ? (
        <ErrorState error={week.error} onRetry={() => week.refetch()} />
      ) : (
        <WeekGrid days={days} dayLabels={labels} blocks={blocks} dayStart={start} dayEnd={end} dayNotes={notes} emptyText={t('tt.noPublished')} />
      )}
      <ExceptionsList classId={classId} monday={monday} canEdit={allowExceptions} />
      {picked && (
        <ExceptionDialog
          classId={classId}
          date={picked.date}
          session={picked.s}
          label={`${subjectName(picked.s.subject_id) ?? ''} · ${formatDate(picked.date, locale)} ${hhmm(picked.s.starts_at)}`}
          onClose={() => setPicked(null)}
        />
      )}
      {dayOff && <DayOffDialog classId={classId} date={dayOff} onClose={() => setDayOff(null)} />}
    </Stack>
  )
}

function useInvalidateWeek() {
  const ctx = useSchool()
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-week'] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-exceptions'] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-teacher-week'] }),
    ])
}

function ExceptionDialog({
  classId,
  date,
  session,
  label,
  onClose,
}: {
  classId: string
  date: string
  session: DaySession
  label: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const teachers = useQuery(teachersQuery(ctx.school.id))
  const invalidate = useInvalidateWeek()
  const [kind, setKind] = useState<'changed' | 'cancelled'>('changed')
  const [substitute, setSubstitute] = useState('')
  const [reason, setReason] = useState('')

  // Is the substitute already teaching somewhere at that time?
  const busy = useQuery({
    queryKey: ['school', ctx.school.id, 'teacher-day', substitute, date],
    enabled: !!substitute,
    queryFn: async () =>
      must(await supabase.rpc('teacher_day', { p_teacher_member_id: substitute, p_date: date })) as {
        starts_at: string
        ends_at: string
      }[],
  })
  const conflict = (busy.data ?? []).some((b) => b.starts_at < session.ends_at! && session.starts_at! < b.ends_at)

  const save = useMutation({
    mutationFn: async () =>
      must(
        await supabase.from('timetable_exceptions').insert({
          school_id: ctx.school.id,
          class_id: classId,
          exception_date: date,
          kind,
          slot_id: session.slot_id,
          teacher_member_id: kind === 'changed' ? substitute : null,
          reason_code: 'teacher_absent',
          reason: reason || null,
          created_by_member_id: ctx.member.id,
        }),
      ),
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('tt.exceptionTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
          <ToggleButtonGroup exclusive value={kind} onChange={(_, v) => v && setKind(v)} size="small">
            <ToggleButton value="changed">{t('tt.substitute')}</ToggleButton>
            <ToggleButton value="cancelled">{t('tt.cancelSession')}</ToggleButton>
          </ToggleButtonGroup>
          {kind === 'changed' && (
            <TextField select label={t('tt.substituteTeacher')} value={substitute} onChange={(e) => setSubstitute(e.target.value)}>
              {(teachers.data ?? [])
                .filter((x) => x.id !== session.teacher_member_id)
                .map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.name}
                  </MenuItem>
                ))}
            </TextField>
          )}
          {conflict && <Alert severity="warning">{t('tt.substituteBusy')}</Alert>}
          <TextField label={t('tt.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('tt.reasonPlaceholder')} />
          {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={kind === 'changed' && !substitute}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DayOffDialog({ classId, date, onClose }: { classId: string; date: string; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const invalidate = useInvalidateWeek()
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: async () =>
      must(
        await supabase.from('timetable_exceptions').insert({
          school_id: ctx.school.id,
          class_id: classId,
          exception_date: date,
          kind: 'day_off',
          reason_code: 'holiday',
          reason: reason || null,
          created_by_member_id: ctx.member.id,
        }),
      ),
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tt.closeDayTitle', { date: formatDate(date, locale) })}</DialogTitle>
      <DialogContent>
        <TextField label={t('tt.reason')} value={reason} onChange={(e) => setReason(e.target.value)} fullWidth sx={{ mt: 1 }} />
        {save.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(save.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending}>
          {t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ExceptionsList({ classId, monday, canEdit }: { classId: string; monday: string; canEdit: boolean }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const invalidate = useInvalidateWeek()
  const names = useQuery(membersNamesQuery(ctx.school.id))
  const list = useQuery({
    queryKey: ['school', ctx.school.id, 'tt-exceptions', classId, monday],
    queryFn: async () =>
      must(
        await supabase
          .from('timetable_exceptions')
          .select('id, exception_date, kind, teacher_member_id, reason, starts_at')
          .eq('class_id', classId)
          .gte('exception_date', monday)
          .lte('exception_date', addDays(monday, 6))
          .order('exception_date'),
      ),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('timetable_exceptions').delete().eq('id', id)),
    onSuccess: invalidate,
  })
  if (!list.data?.length) return null
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        {t('tt.exceptionsThisWeek')}
      </Typography>
      <Stack spacing={1}>
        {list.data.map((e) => (
          <Stack key={e.id} direction="row" spacing={1.5} sx={{ alignItems: 'center', borderTop: `1px solid ${tokens.lineSoft}`, pt: 1 }}>
            <Typography sx={{ minWidth: 110, fontWeight: 500 }}>{formatDate(e.exception_date, locale)}</Typography>
            <Tag tone={e.kind === 'cancelled' || e.kind === 'day_off' ? 'warn' : 'info'} label={t(`tt.kind.${e.kind}`)} />
            <Typography sx={{ flex: 1, fontSize: 14 }}>
              {e.teacher_member_id ? t('tt.replacedBy', { name: names.data?.[e.teacher_member_id] ?? '' }) : ''}
              {e.reason ? ` · ${e.reason}` : ''}
            </Typography>
            {canEdit && (
              <Button size="small" color="error" onClick={() => remove.mutate(e.id)}>
                {t('common.delete')}
              </Button>
            )}
          </Stack>
        ))}
      </Stack>
    </Paper>
  )
}
