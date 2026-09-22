import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { AppShell } from '#/components/AppShell'
import { PageIntro, StatCard, Tag, fullName, initials, type Tone } from '#/components/ui'
import { EmptyState, Loading, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, hhmm, todayIso } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { subjectsQuery } from '#/features/structure/api'
import { studentsQuery } from '#/features/students/api'
import type { DaySession } from '#/features/timetable/api'
import { tokens } from '#/theme/theme'

export const Route = createFileRoute('/_app/attendance')({ component: AttendancePage })

type Status = 'present' | 'absent' | 'late' | 'excused'
const TONE: Record<Status, Tone> = { present: 'ok', absent: 'danger', late: 'warn', excused: 'info' }

function AttendancePage() {
  const { t } = useI18n()
  const ctx = useSchool()
  return (
    <AppShell title={t('nav.attendance')}>
      {ctx.isOffice || ctx.role === 'teacher' ? <RollCall /> : <FamilyAbsences />}
    </AppShell>
  )
}

// Roll call (spec 06): one class, one date, one session; everyone present by
// default, the teacher flips the exceptions. Re-saving updates, never duplicates.
function RollCall() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [slotKey, setSlotKey] = useState<string>('day')
  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!classId && classes.data?.length) setClassId(classes.data[0].id)
  }, [classes.data, classId])

  const sessions = useQuery({
    queryKey: ['school', ctx.school.id, 'tt-day', classId, date],
    enabled: !!classId,
    queryFn: async () =>
      (must(await supabase.rpc('timetable_day', { p_class_id: classId, p_date: date })) as DaySession[]).filter(
        (s) => s.slot_id && (s.status === 'scheduled' || s.status === 'changed'),
      ),
  })
  // A teacher marks their own sessions; default to the first one that day.
  useEffect(() => {
    if (!sessions.data) return
    const mine = sessions.data.find((s) => s.teacher_member_id === ctx.member.id) ?? sessions.data[0]
    setSlotKey(mine?.slot_id ?? 'day')
  }, [sessions.data, ctx.member.id])
  const slotId = slotKey === 'day' ? null : slotKey

  const roster = useQuery({
    queryKey: ['school', ctx.school.id, 'roster', classId],
    enabled: !!classId,
    queryFn: async () =>
      (
        must(
          await supabase
            .from('enrollments')
            .select('student:students(id, first_name, last_name)')
            .eq('class_id', classId)
            .eq('status', 'active'),
        ) as unknown as { student: { id: string; first_name: string; last_name: string } }[]
      )
        .map((r) => r.student)
        .filter(Boolean)
        .sort((a, b) => a.last_name.localeCompare(b.last_name)),
  })

  const existing = useQuery({
    queryKey: ['school', ctx.school.id, 'attendance', classId, date, slotKey],
    enabled: !!classId,
    queryFn: async () => {
      let q = supabase.from('attendance_records').select('id, student_id, status, justification').eq('class_id', classId).eq('session_date', date)
      q = slotId ? q.eq('slot_id', slotId) : q.is('slot_id', null)
      return must(await q)
    },
  })

  useEffect(() => {
    const m: Record<string, Status> = {}
    for (const r of existing.data ?? []) m[r.student_id] = r.status as Status
    setMarks(m)
    setSaved(false)
  }, [existing.data])

  const save = useMutation({
    mutationFn: async () => {
      const rows = (roster.data ?? []).map((s) => ({
        school_id: ctx.school.id,
        class_id: classId,
        student_id: s.id,
        session_date: date,
        slot_id: slotId,
        status: marks[s.id] ?? 'present',
      }))
      must(await supabase.from('attendance_records').upsert(rows, { onConflict: 'student_id,session_date,slot_id' }))
    },
    onSuccess: async () => {
      setSaved(true)
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'attendance'] })
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'absences-day'] })
    },
  })

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0 }
    for (const s of roster.data ?? []) c[marks[s.id] ?? 'present']++
    return c
  }, [roster.data, marks])
  const subjectName = (id: string | null) => subjects.data?.find((s) => s.id === id)?.name ?? '—'

  if (!ctx.year) return <EmptyState title={t('year.none')} />
  if (classes.isPending) return <Loading rows={5} />
  if (!classes.data?.length) return <EmptyState title={ctx.role === 'teacher' ? t('att.noTeacherClass') : t('tt.noClasses')} />

  return (
    <>
      <PageIntro title={t('att.title')} subtitle={t('att.subtitle')} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField select label={t('students.class')} value={classId} onChange={(e) => setClassId(e.target.value)} sx={{ minWidth: 220 }}>
            {classes.data.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField type="date" label={t('common.date')} value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField select label={t('att.session')} value={slotKey} onChange={(e) => setSlotKey(e.target.value)} sx={{ minWidth: 260 }}>
            <MenuItem value="day">{t('att.wholeDay')}</MenuItem>
            {(sessions.data ?? []).map((s) => (
              <MenuItem key={s.slot_id!} value={s.slot_id!}>
                {hhmm(s.starts_at)}–{hhmm(s.ends_at)} · {subjectName(s.subject_id)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
        {(['present', 'absent', 'late', 'excused'] as const).map((k) => (
          <StatCard key={k} value={counts[k]} label={t(`att.status.${k}`)} />
        ))}
      </Stack>
      <QueryState
        query={roster}
        rows={6}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('att.noStudents')} /> : null)}
      >
        {(rows) => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableBody>
                {rows.map((s) => {
                  const v = marks[s.id] ?? 'present'
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: '#E7EEF7', color: '#2A4A6B' }}>{initials(fullName(s))}</Avatar>
                          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{fullName(s)}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={v}
                          onChange={(_, nv) => nv && (setMarks((m) => ({ ...m, [s.id]: nv })), setSaved(false))}
                          aria-label={fullName(s)}
                        >
                          {(['present', 'absent', 'late', 'excused'] as const).map((k) => (
                            <ToggleButton key={k} value={k} sx={{ px: 1.25, '&.Mui-selected': { bgcolor: k === 'present' ? tokens.accentSoft : k === 'absent' ? tokens.dangerSoft : tokens.warnSoft } }}>
                              {t(`att.status.${k}`)}
                            </ToggleButton>
                          ))}
                        </ToggleButtonGroup>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      <Stack direction="row" spacing={1.5} sx={{ mt: 2, alignItems: 'center' }}>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={!roster.data?.length}>
          {t('att.save')}
        </Button>
        {saved && <Typography sx={{ color: tokens.accentDark, fontSize: 14 }}>{t('att.saved', { date: formatDate(date, locale) })}</Typography>}
      </Stack>
      {save.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(save.error, t)}</Alert>}
      {ctx.isOffice && <SchoolAbsencesOfDay date={date} />}
    </>
  )
}

function SchoolAbsencesOfDay({ date }: { date: string }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const rows = useQuery({
    queryKey: ['school', ctx.school.id, 'absences-day', date],
    queryFn: async () =>
      must(
        await supabase
          .from('attendance_records')
          .select('id, status, justification, student:students(first_name, last_name), class:classes(name)')
          .eq('school_id', ctx.school.id)
          .eq('session_date', date)
          .neq('status', 'present'),
      ) as unknown as { id: string; status: Status; justification: string | null; student: { first_name: string; last_name: string }; class: { name: string } }[],
  })
  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h4" sx={{ mb: 1.5 }}>
        {t('att.schoolDay', { date: formatDate(date, locale) })}
      </Typography>
      <QueryState query={rows} empty={(d) => (d.length === 0 ? <Typography color="text.secondary">{t('att.noneToday')}</Typography> : null)}>
        {(d) => (
          <Paper variant="outlined">
            <Table size="small">
              <TableBody>
                {d.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{fullName(r.student)}</TableCell>
                    <TableCell>{r.class?.name}</TableCell>
                    <TableCell>
                      <Tag tone={TONE[r.status]} label={t(`att.status.${r.status}`)} />
                    </TableCell>
                    <TableCell sx={{ color: tokens.inkMuted }}>{r.justification ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
    </Box>
  )
}

// Parent / student: their own records, read-only; a parent can justify.
function FamilyAbsences() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const students = useQuery(studentsQuery(ctx.school.id))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const records = useQuery({
    queryKey: ['school', ctx.school.id, 'attendance', 'family'],
    queryFn: async () =>
      must(
        await supabase
          .from('attendance_records')
          .select('id, student_id, session_date, status, justification, minutes_late, slot:timetable_slots(starts_at, ends_at, subject_id)')
          .neq('status', 'present')
          .order('session_date', { ascending: false }),
      ) as unknown as {
        id: string
        student_id: string
        session_date: string
        status: Status
        justification: string | null
        slot: { starts_at: string; ends_at: string; subject_id: string | null } | null
      }[],
  })
  const [justifying, setJustifying] = useState<string | null>(null)
  const name = (id: string) => students.data?.find((s) => s.id === id)?.first_name ?? ''

  return (
    <>
      <PageIntro title={t('att.familyTitle')} subtitle={ctx.role === 'parent' ? t('att.familySubtitle') : t('att.studentSubtitle')} />
      <QueryState query={records} rows={4} empty={(d) => (d.length === 0 ? <EmptyState title={t('att.noAbsences')} /> : null)}>
        {(rows) => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {ctx.role === 'parent' && <TableCell>{t('tt.child')}</TableCell>}
                  <TableCell>{t('common.date')}</TableCell>
                  <TableCell>{t('att.session')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell>{t('att.justification')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {ctx.role === 'parent' && <TableCell sx={{ fontWeight: 600 }}>{name(r.student_id)}</TableCell>}
                    <TableCell>{formatDate(r.session_date, locale)}</TableCell>
                    <TableCell>
                      {r.slot ? `${hhmm(r.slot.starts_at)} · ${subjects.data?.find((s) => s.id === r.slot!.subject_id)?.name ?? ''}` : t('att.wholeDay')}
                    </TableCell>
                    <TableCell>
                      <Tag tone={TONE[r.status]} label={t(`att.status.${r.status}`)} />
                    </TableCell>
                    <TableCell>
                      {r.justification ??
                        (ctx.role === 'parent' && (r.status === 'absent' || r.status === 'late') ? (
                          <Button size="small" onClick={() => setJustifying(r.id)}>
                            {t('att.justify')}
                          </Button>
                        ) : (
                          '—'
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      {justifying && <JustifyDialog id={justifying} onClose={() => setJustifying(null)} />}
    </>
  )
}

function JustifyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const justify = useMutation({
    mutationFn: async () => must(await supabase.rpc('justify_absence', { p_record_id: id, p_justification: text })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'attendance'] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('att.justifyTitle')}</DialogTitle>
      <DialogContent>
        <TextField label={t('att.justification')} value={text} onChange={(e) => setText(e.target.value)} fullWidth multiline minRows={2} sx={{ mt: 1 }} placeholder={t('att.justifyPlaceholder')} />
        {justify.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(justify.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => justify.mutate()} loading={justify.isPending} disabled={!text.trim()}>
          {t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
