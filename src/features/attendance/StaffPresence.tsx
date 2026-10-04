import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  FormControlLabel,
  Switch,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import LoginOutlined from '@mui/icons-material/LoginOutlined'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined'
import UndoOutlined from '@mui/icons-material/UndoOutlined'
import { Tag, initials, type Tone } from '#/components/ui'
import { EmptyState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatPhone, hhmm, nowTime, todayIso, toMinutes } from '#/lib/format'
import { membersQuery, type MemberRow } from '#/features/team/api'
import type { TeacherSession } from '#/features/timetable/api'
import { dayOf, readHoraires } from '#/features/setup/schedule'
import { GRACE, StaffIncidentsDialog } from './history'
import { TimeField } from '#/components/TimeField'
import { tokens } from '#/theme/theme'
import { WhatsAppButton } from '#/components/WhatsApp'

// Late arrivals in a month from which it becomes "excessive"
const EXCESSIVE_LATES = 3

type Presence = {
  id: string
  member_id: string
  day: string
  arrived_at: string | null
  left_at: string | null
  absent: boolean
  justified: boolean
  note: string | null
  expected_start: string | null
  expected_end: string | null
}

type Verdict = { tone: Tone; label: string }

function nextMonth(first: string) {
  const [y, m] = first.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function lateBy(p: Pick<Presence, 'arrived_at' | 'expected_start'>) {
  const a = toMinutes(p.arrived_at)
  const e = toMinutes(p.expected_start)
  return a != null && e != null && a - e > GRACE ? a - e : 0
}
function earlyBy(p: Pick<Presence, 'left_at' | 'expected_end'>) {
  const l = toMinutes(p.left_at)
  const e = toMinutes(p.expected_end)
  return l != null && e != null && e - l > GRACE ? e - l : 0
}

type Hours = { member_id: string; weekday: number; starts_at: string; ends_at: string }
// Where the expected hours come from: the person's usual hours, the school's
// opening (assistants), or the timetable (first and last session)
type Source = 'usual' | 'school' | 'timetable'
type Expected = { start: string | null; end: string | null; count: number; source: Source }

// The school's opening and closing on a weekday: earliest opening, latest
// closing over the cycles open that day
function schoolHours(settings: unknown, weekday: number) {
  const days = readHoraires(settings)
    .map((h) => dayOf(h, weekday))
    .filter((d): d is NonNullable<typeof d> => !!d)
  if (!days.length) return null
  return { start: days.map((d) => d.start).sort()[0], end: days.map((d) => d.end).sort().at(-1)! }
}

// ISO weekday of a yyyy-mm-dd date (1 = Monday)
function isoWeekday(day: string) {
  const d = new Date(`${day}T12:00:00`).getDay()
  return d === 0 ? 7 : d
}

const hoursQuery = (schoolId: string) => ({
  queryKey: ['school', schoolId, 'staff-hours'],
  queryFn: async () =>
    must(await supabase.from('staff_hours').select('member_id, weekday, starts_at, ends_at').eq('school_id', schoolId)) as Hours[],
})

// The hours a member is expected on a day, outside the table (assistant's
// presence card): usual hours, else the school's opening (assistants), else
// the timetable's first and last session.
export async function fetchExpected(
  schoolId: string,
  settings: unknown,
  member: { id: string; is_assistant: boolean },
  day: string,
): Promise<{ start: string | null; end: string | null }> {
  const weekday = isoWeekday(day)
  const usual = must(
    await supabase.from('staff_hours').select('starts_at, ends_at').eq('school_id', schoolId).eq('member_id', member.id).eq('weekday', weekday),
  )[0]
  if (usual) return { start: hhmm(usual.starts_at), end: hhmm(usual.ends_at) }
  if (member.is_assistant) return schoolHours(settings, weekday) ?? { start: null, end: null }
  const sessions = (must(await supabase.rpc('teacher_day', { p_teacher_member_id: member.id, p_date: day })) as TeacherSession[]).filter(
    (x) => x.starts_at && x.status !== 'cancelled',
  )
  const starts = sessions.map((x) => hhmm(x.starts_at)).sort()
  const ends = sessions.map((x) => hhmm(x.ends_at)).sort()
  return { start: starts[0] ?? null, end: ends.at(-1) ?? null }
}

// The secrétariat notes when each teacher arrives and leaves. Compared with the
// teacher's usual hours for that weekday when set, else with the day's
// timetable (first and last session): late arrivals, early departures and
// absences are red; too many late arrivals in the month too.
export function StaffPresencePanel() {
  const { t } = useI18n()
  const ctx = useSchool()
  const [day, setDay] = useState(todayIso())
  const members = useQuery(membersQuery(ctx.school.id))
  const teachers = useMemo(
    () => (members.data ?? []).filter((m) => m.role === 'teacher' && m.status === 'active').sort((a, b) => (a.user?.full_name ?? '').localeCompare(b.user?.full_name ?? '')),
    [members.data],
  )
  const hours = useQuery(hoursQuery(ctx.school.id))
  const [editingHours, setEditingHours] = useState<MemberRow | null>(null)
  const timetable = useQuery({
    queryKey: ['school', ctx.school.id, 'staff-expected', day, teachers.map((m) => m.id).join()],
    enabled: teachers.length > 0,
    queryFn: async () => {
      const out: Record<string, { start: string | null; end: string | null; count: number }> = {}
      await Promise.all(
        teachers.map(async (m) => {
          const sessions = (must(await supabase.rpc('teacher_day', { p_teacher_member_id: m.id, p_date: day })) as TeacherSession[]).filter(
            (s) => s.starts_at && s.status !== 'cancelled',
          )
          const starts = sessions.map((s) => hhmm(s.starts_at)).sort()
          const ends = sessions.map((s) => hhmm(s.ends_at)).sort()
          out[m.id] = { start: starts[0] ?? null, end: ends[ends.length - 1] ?? null, count: sessions.length }
        }),
      )
      return out
    },
  })
  // Usual hours for this weekday first; else an assistant follows the
  // school's opening, a teacher the timetable
  const weekday = isoWeekday(day)
  const expectedOf = (m: MemberRow): Expected | undefined => {
    const count = timetable.data?.[m.id]?.count ?? 0
    const h = hours.data?.find((x) => x.member_id === m.id && x.weekday === weekday)
    if (h) return { start: hhmm(h.starts_at), end: hhmm(h.ends_at), count, source: 'usual' }
    if (m.is_assistant) {
      const open = schoolHours(ctx.school.settings, weekday)
      return { start: open?.start ?? null, end: open?.end ?? null, count, source: 'school' }
    }
    const tt = timetable.data?.[m.id]
    return tt && { ...tt, source: 'timetable' }
  }
  const monthStart = `${day.slice(0, 7)}-01`
  const presence = useQuery({
    queryKey: ['school', ctx.school.id, 'staff-presence', monthStart],
    queryFn: async () =>
      must(
        await supabase
          .from('staff_presence')
          .select('id, member_id, day, arrived_at, left_at, absent, justified, note, expected_start, expected_end')
          .eq('school_id', ctx.school.id)
          .gte('day', monthStart)
          .lt('day', nextMonth(monthStart)),
      ) as Presence[],
  })

  // Justified ones don't count towards "excessive"
  const latesThisMonth = (memberId: string) =>
    (presence.data ?? []).filter((p) => p.member_id === memberId && !p.justified && (lateBy(p) > 0 || earlyBy(p) > 0 || p.absent)).length
  const [historyOf, setHistoryOf] = useState<MemberRow | null>(null)

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField type="date" label={t('common.date')} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t('presence.hint', { grace: GRACE, n: EXCESSIVE_LATES })}
        </Typography>
      </Stack>
      {members.isPending || presence.isPending ? (
        <Loading rows={4} />
      ) : teachers.length === 0 ? (
        <EmptyState title={t('presence.noTeachers')} />
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('role.teacher')}</TableCell>
                <TableCell>{t('presence.planned')}</TableCell>
                <TableCell>{t('presence.arrival')}</TableCell>
                <TableCell>{t('presence.departure')}</TableCell>
                <TableCell>{t('presence.absent')}</TableCell>
                <TableCell>{t('presence.notes')}</TableCell>
                <TableCell>{t('presence.month')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {teachers.map((m) => (
                <PresenceRow
                  key={`${m.id}-${day}`}
                  memberId={m.id}
                  name={m.user?.full_name ?? '—'}
                  phone={m.user?.phone ?? null}
                  day={day}
                  isAssistant={m.is_assistant}
                  expected={expectedOf(m)}
                  onEditHours={() => setEditingHours(m)}
                  row={(presence.data ?? []).find((p) => p.member_id === m.id && p.day === day)}
                  monthIssues={latesThisMonth(m.id)}
                  onHistory={() => setHistoryOf(m)}
                  monthStart={monthStart}
                />
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {historyOf && <StaffIncidentsDialog memberId={historyOf.id} name={historyOf.user?.full_name ?? ''} onClose={() => setHistoryOf(null)} />}
      {editingHours && <HoursDialog member={editingHours} day={day} hours={(hours.data ?? []).filter((h) => h.member_id === editingHours.id)} onClose={() => setEditingHours(null)} />}
    </>
  )
}

function PresenceRow({
  memberId,
  name,
  phone,
  day,
  isAssistant,
  expected,
  onEditHours,
  row,
  monthIssues,
  monthStart,
  onHistory,
}: {
  memberId: string
  name: string
  phone: string | null
  day: string
  isAssistant: boolean
  expected?: Expected
  onEditHours: () => void
  row?: Presence
  monthIssues: number
  monthStart: string
  onHistory: () => void
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  // Nothing recorded yet: arrival and departure are filled with the expected
  // hours, so the secrétariat confirms in one click or corrects first
  const planned = !row
  const initialArrived = row ? hhmm(row.arrived_at) : (expected?.start ?? '')
  const initialLeft = row ? hhmm(row.left_at) : (expected?.end ?? '')
  const [arrived, setArrived] = useState(initialArrived)
  const [left, setLeft] = useState(initialLeft)
  const [absent, setAbsent] = useState(row?.absent ?? false)
  const [note, setNote] = useState(row?.note ?? '')
  const [justified, setJustified] = useState(row?.justified ?? false)
  const [touched, setTouched] = useState({ arrived: false, left: false })
  useEffect(() => {
    setArrived(initialArrived)
    setLeft(initialLeft)
    setAbsent(row?.absent ?? false)
    setNote(row?.note ?? '')
    setJustified(row?.justified ?? false)
    setTouched({ arrived: false, left: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expected loads after the row
  }, [row, expected?.start, expected?.end])

  const save = useMutation({
    mutationFn: async (patch?: { arrived?: string; left?: string }) =>
      must(
        await supabase.from('staff_presence').upsert(
          {
            school_id: ctx.school.id,
            member_id: memberId,
            day,
            arrived_at: absent ? null : (patch?.arrived ?? arrived) || null,
            left_at: absent ? null : (patch?.left ?? left) || null,
            absent,
            justified,
            note: note.trim() || null,
            expected_start: expected?.start ?? null,
            expected_end: expected?.end ?? null,
            recorded_by_member_id: ctx.member.id,
          },
          { onConflict: 'member_id,day' },
        ),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'staff-presence', monthStart] }),
  })
  // Recorded by mistake: back to "not recorded" (the expected hours again)
  const [undoing, setUndoing] = useState(false)
  const undo = useMutation({
    mutationFn: async () => must(await supabase.from('staff_presence').delete().eq('id', row!.id)),
    onSuccess: async () => {
      setUndoing(false)
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
    },
  })

  const current = { arrived_at: arrived || null, left_at: left || null, expected_start: expected?.start ?? null, expected_end: expected?.end ?? null }
  const late = lateBy(current)
  const early = earlyBy(current)
  const extra = (() => {
    const l = toMinutes(left)
    const e = toMinutes(expected?.end)
    return l != null && e != null && l - e > GRACE ? l - e : 0
  })()
  const verdicts: Verdict[] = planned && !touched.arrived && !touched.left && !absent
    ? expected?.start
      ? [{ tone: 'neutral', label: t('presence.toConfirm') }]
      : []
    : absent
    ? [{ tone: 'danger', label: t('presence.absent') }]
    : [
        ...(late ? [{ tone: 'danger' as Tone, label: t('presence.late', { n: late }) }] : []),
        ...(early ? [{ tone: 'danger' as Tone, label: t('presence.leftEarly', { n: early }) }] : []),
        ...(extra ? [{ tone: 'info' as Tone, label: t('presence.stayed', { n: extra }) }] : []),
        ...(arrived && !late && !early ? [{ tone: 'ok' as Tone, label: t('presence.onTime') }] : []),
      ]
  // A planned row can be confirmed as it is
  const dirty =
    (planned && (!!arrived || absent)) ||
    arrived !== hhmm(row?.arrived_at) || left !== hhmm(row?.left_at) || absent !== (row?.absent ?? false) || note !== (row?.note ?? '') || justified !== (row?.justified ?? false)
  const isToday = day === todayIso()
  const incident = verdicts.some((v) => v.tone === 'danger')
  const redBg = incident && !justified

  return (
    <TableRow sx={{ bgcolor: redBg ? tokens.dangerSoft : undefined }}>
      <TableCell>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: tokens.accentSoft, color: tokens.accentDark }}>{initials(name)}</Avatar>
          <div>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{name}</Typography>
            {isAssistant && <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>{t('role.assistant')}</Typography>}
            {phone && (
              <Typography dir="ltr" sx={{ fontSize: 12, color: tokens.inkMuted, textAlign: 'start' }}>
                {formatPhone(phone)}
              </Typography>
            )}
          </div>
          {phone && !arrived && !absent && expected?.start ? (
            <WhatsAppButton phone={phone} text={t('wa.teacherLate', { name, time: expected.start ?? '' })} tooltip={t('wa.teacherLateTooltip')} />
          ) : null}
        </Stack>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap', color: tokens.inkSoft }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Tooltip title={t('presence.editHours')}>
            <ButtonBase
              onClick={onEditHours}
              aria-label={`${t('presence.editHours')} — ${name}`}
              sx={{ display: 'block', textAlign: 'start', px: 0.75, py: 0.25, borderRadius: '6px', '&:hover': { bgcolor: tokens.fill } }}
            >
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <ScheduleOutlined sx={{ fontSize: 15, color: expected?.source === 'usual' ? tokens.accent : tokens.inkMuted }} />
                <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{expected?.start ? `${expected.start} → ${expected.end}` : t('presence.noClass')}</Typography>
              </Stack>
              {expected?.start && (
                <Typography sx={{ fontSize: 11.5, color: tokens.inkMuted }}>{t(`presence.source.${expected.source}`)}</Typography>
              )}
            </ButtonBase>
          </Tooltip>
        </Stack>
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <PresenceTime
            value={arrived}
            disabled={absent}
            label={`${t('presence.arrival')} — ${name}`}
            onChange={(v) => (setArrived(v), setTouched((x) => ({ ...x, arrived: true })))}
          />
          {isToday && !row?.arrived_at && !absent && (
            <Tooltip title={t('presence.arrivedNow')}>
              <IconButton
                size="small"
                aria-label={`${t('presence.arrivedNow')} — ${name}`}
                onClick={() => {
                  const n = nowTime()
                  setArrived(n)
                  setTouched((x) => ({ ...x, arrived: true }))
                  // the departure isn't known yet
                  if (planned) setLeft('')
                  save.mutate({ arrived: n, left: planned ? '' : undefined })
                }}
              >
                <LoginOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <PresenceTime
            value={left}
            disabled={absent}
            label={`${t('presence.departure')} — ${name}`}
            onChange={(v) => (setLeft(v), setTouched((x) => ({ ...x, left: true })))}
          />
          {isToday && !row?.left_at && !absent && (
            <Tooltip title={t('presence.leftNow')}>
              <IconButton
                size="small"
                aria-label={`${t('presence.leftNow')} — ${name}`}
                onClick={() => {
                  const n = nowTime()
                  setLeft(n)
                  setTouched((x) => ({ ...x, left: true }))
                  save.mutate({ left: n })
                }}
              >
                <LogoutOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </TableCell>
      <TableCell>
        <Checkbox checked={absent} onChange={(e) => setAbsent(e.target.checked)} slotProps={{ input: { 'aria-label': `${t('presence.absent')} — ${name}` } }} />
        {incident && (
          <FormControlLabel
            control={<Checkbox size="small" checked={justified} onChange={(e) => setJustified(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12.5 }}>{t('abs.justifiedF')}</Typography>}
            sx={{ m: 0, display: 'flex' }}
          />
        )}
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {verdicts.map((v) => (
            <Tag key={v.label} tone={v.tone} label={v.label} />
          ))}
        </Stack>
        <TextField
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('presence.notePlaceholder')}
          variant="standard"
          fullWidth
          sx={{ mt: 0.5, minWidth: 160 }}
          slotProps={{ htmlInput: { 'aria-label': `${t('presence.note')} — ${name}` } }}
        />
      </TableCell>
      <TableCell>
        <Tooltip title={t('abs.seeYear')}>
          <ButtonBase onClick={onHistory} aria-label={`${t('abs.seeYear')} — ${name}`} sx={{ borderRadius: '6px' }}>
            <Tag tone={monthIssues >= EXCESSIVE_LATES ? 'danger' : monthIssues > 0 ? 'warn' : 'neutral'} label={monthIssues >= EXCESSIVE_LATES ? t('presence.excessive', { n: monthIssues }) : String(monthIssues)} sx={{ cursor: 'pointer' }} />
          </ButtonBase>
        </Tooltip>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
          <Button size="small" variant={dirty ? 'contained' : 'text'} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            {planned ? t('presence.confirm') : t('common.save')}
          </Button>
          {row && (
            <Tooltip title={t('presence.undo')}>
              <IconButton size="small" aria-label={`${t('presence.undo')} — ${name}`} onClick={() => setUndoing(true)}>
                <UndoOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        {(save.isError || undo.isError) && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage(save.error ?? undo.error, t)}
          </Alert>
        )}
        {undoing && (
          <Dialog open onClose={() => setUndoing(false)} fullWidth maxWidth="xs">
            <DialogTitle>{t('presence.undoTitle', { name })}</DialogTitle>
            <DialogContent>
              <Typography>{t('presence.undoHint')}</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setUndoing(false)}>{t('common.cancel')}</Button>
              <Button variant="contained" color="error" loading={undo.isPending} onClick={() => undo.mutate()}>
                {t('presence.undo')}
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </TableCell>
    </TableRow>
  )
}

function PresenceTime({ value, disabled, label, onChange }: { value: string; disabled: boolean; label: string; onChange: (v: string) => void }) {
  return (
    <TimeField
      value={value}
      onChange={onChange}
      disabled={disabled}
      sx={{ width: 150, '& input': { fontSize: 15 } }}
      slotProps={{ htmlInput: { 'aria-label': label } }}
    />
  )
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

// A teacher's usual arrival and departure, school day by school day. A day
// without fixed hours follows the timetable (first and last session), shown
// beside it so the choice is informed.
function HoursDialog({ member, hours, day, onClose }: { member: MemberRow; hours: Hours[]; day: string; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  // School days (the horaires), plus any day that already has hours
  const schoolDays = new Set(readHoraires(ctx.school.settings).flatMap((h) => h.days.map(Number)))
  const days = WEEKDAYS.filter((d) => schoolDays.has(d) || hours.some((h) => h.weekday === d) || schoolDays.size === 0)
  // What the timetable gives each weekday, over the week of the chosen date
  const week = useQuery({
    queryKey: ['school', ctx.school.id, 'teacher-week', member.id, day],
    queryFn: async () => {
      const monday = new Date(`${day}T12:00:00`)
      monday.setDate(monday.getDate() - (isoWeekday(day) - 1))
      const out: Record<number, { start: string; end: string } | null> = {}
      await Promise.all(
        days.map(async (d) => {
          const date = new Date(monday)
          date.setDate(monday.getDate() + d - 1)
          const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const sessions = (must(await supabase.rpc('teacher_day', { p_teacher_member_id: member.id, p_date: iso })) as TeacherSession[]).filter(
            (x) => x.starts_at && x.status !== 'cancelled',
          )
          const starts = sessions.map((x) => hhmm(x.starts_at)).sort()
          const ends = sessions.map((x) => hhmm(x.ends_at)).sort()
          out[d] = member.is_assistant
            ? schoolHours(ctx.school.settings, d)
            : starts.length
              ? { start: starts[0], end: ends[ends.length - 1] }
              : null
        }),
      )
      return out
    },
  })
  const [rows, setRows] = useState<Record<number, { on: boolean; start: string; end: string }>>(() =>
    Object.fromEntries(
      WEEKDAYS.map((d) => {
        const h = hours.find((x) => x.weekday === d)
        return [d, { on: !!h, start: hhmm(h?.starts_at), end: hhmm(h?.ends_at) }]
      }),
    ),
  )
  // 2024-01-01 was a Monday
  const dayName = (d: number) => new Date(2024, 0, d).toLocaleDateString(locale, { weekday: 'long' })
  const set = (d: number, patch: Partial<{ on: boolean; start: string; end: string }>) => setRows((r) => ({ ...r, [d]: { ...r[d], ...patch } }))
  const turnOn = (d: number) => {
    // Start from the timetable of that day, else from another day's hours
    const from = week.data?.[d] ?? days.map((x) => rows[x]).find((r) => r.on && r.start && r.end) ?? { start: '08:00', end: '16:00' }
    set(d, { on: true, start: rows[d].start || from.start, end: rows[d].end || from.end })
  }
  const applyToAll = (d: number) =>
    setRows((r) => ({ ...r, ...Object.fromEntries(days.map((x) => [x, { on: true, start: r[d].start, end: r[d].end }])) }))
  const invalid = days.filter((d) => rows[d].on && (!rows[d].start || !rows[d].end || rows[d].end <= rows[d].start))
  const save = useMutation({
    mutationFn: async () => {
      const fixed = WEEKDAYS.filter((d) => rows[d].on)
      const free = WEEKDAYS.filter((d) => !rows[d].on)
      if (fixed.length)
        must(
          await supabase.from('staff_hours').upsert(
            fixed.map((d) => ({ school_id: ctx.school.id, member_id: member.id, weekday: d, starts_at: rows[d].start, ends_at: rows[d].end })),
            { onConflict: 'member_id,weekday' },
          ),
        )
      if (free.length) must(await supabase.from('staff_hours').delete().eq('member_id', member.id).in('weekday', free))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'staff-hours'] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('presence.hoursTitle', { name: member.user?.full_name ?? '' })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('presence.hoursHint')}
        </Typography>
        <Stack spacing={1}>
          {days.map((d) => {
            const r = rows[d]
            const tt = week.data?.[d]
            const firstFixed = days.find((x) => rows[x].on && rows[x].start && rows[x].end)
            return (
              <Box
                key={d}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 1.5,
                  py: 1,
                  borderRadius: '8px',
                  border: `1px solid ${r.on ? tokens.accentLine : tokens.lineSoft}`,
                  bgcolor: r.on ? tokens.accentSoft : 'transparent',
                }}
              >
                <Typography sx={{ width: 96, textTransform: 'capitalize', fontWeight: 600, fontSize: 14 }}>{dayName(d)}</Typography>
                <FormControlLabel
                  control={<Switch size="small" checked={r.on} onChange={(e) => (e.target.checked ? turnOn(d) : set(d, { on: false }))} />}
                  label={<Typography sx={{ fontSize: 13 }}>{t('presence.fixedHours')}</Typography>}
                  sx={{ m: 0 }}
                />
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  {r.on ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TimeField size="small" value={r.start} onChange={(v) => set(d, { start: v })} sx={{ width: 140 }} error={invalid.includes(d)} slotProps={{ htmlInput: { 'aria-label': `${dayName(d)} — ${t('presence.arrival')}` } }} />
                      <Typography color="text.secondary">→</Typography>
                      <TimeField size="small" value={r.end} onChange={(v) => set(d, { end: v })} sx={{ width: 140 }} error={invalid.includes(d)} slotProps={{ htmlInput: { 'aria-label': `${dayName(d)} — ${t('presence.departure')}` } }} />
                    </Stack>
                  ) : (
                    <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>
                      {week.isPending
                        ? '…'
                        : tt
                          ? t(member.is_assistant ? 'presence.followsSchool' : 'presence.followsTimetable', { start: tt.start, end: tt.end })
                          : t(member.is_assistant ? 'presence.schoolClosed' : 'presence.noClassThatDay')}
                    </Typography>
                  )}
                </Box>
                {r.on && d === firstFixed && days.length > 1 && (
                  <Button size="small" onClick={() => applyToAll(d)}>
                    {t('presence.applyToAll')}
                  </Button>
                )}
              </Box>
            )
          })}
        </Stack>
        {invalid.length > 0 && <Alert severity="warning" sx={{ mt: 2 }}>{t('presence.hoursInvalid')}</Alert>}
        {save.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(save.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={invalid.length > 0}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
