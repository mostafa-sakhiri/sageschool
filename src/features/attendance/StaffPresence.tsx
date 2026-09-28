import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Avatar,
  Button,
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
import { Tag, initials, type Tone } from '#/components/ui'
import { EmptyState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatPhone, hhmm, nowTime, todayIso, toMinutes } from '#/lib/format'
import { membersQuery, type MemberRow } from '#/features/team/api'
import type { TeacherSession } from '#/features/timetable/api'
import { tokens } from '#/theme/theme'
import { WhatsAppButton } from '#/components/WhatsApp'

// Minutes of grace before an arrival counts as late (or a departure as early)
const GRACE = 5
// Late arrivals in a month from which it becomes "excessive"
const EXCESSIVE_LATES = 3

type Presence = {
  id: string
  member_id: string
  day: string
  arrived_at: string | null
  left_at: string | null
  absent: boolean
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
type Expected = { start: string | null; end: string | null; count: number; usual: boolean }

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
  // Usual hours for this weekday win over the timetable
  const weekday = isoWeekday(day)
  const expectedOf = (memberId: string): Expected | undefined => {
    const h = hours.data?.find((x) => x.member_id === memberId && x.weekday === weekday)
    if (h) return { start: hhmm(h.starts_at), end: hhmm(h.ends_at), count: timetable.data?.[memberId]?.count ?? 0, usual: true }
    const tt = timetable.data?.[memberId]
    return tt && { ...tt, usual: false }
  }
  const monthStart = `${day.slice(0, 7)}-01`
  const presence = useQuery({
    queryKey: ['school', ctx.school.id, 'staff-presence', monthStart],
    queryFn: async () =>
      must(
        await supabase
          .from('staff_presence')
          .select('id, member_id, day, arrived_at, left_at, absent, note, expected_start, expected_end')
          .eq('school_id', ctx.school.id)
          .gte('day', monthStart)
          .lt('day', nextMonth(monthStart)),
      ) as Presence[],
  })

  const latesThisMonth = (memberId: string) =>
    (presence.data ?? []).filter((p) => p.member_id === memberId && (lateBy(p) > 0 || earlyBy(p) > 0 || p.absent)).length

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
                <TableCell>{t('common.status')}</TableCell>
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
                  expected={expectedOf(m.id)}
                  onEditHours={() => setEditingHours(m)}
                  row={(presence.data ?? []).find((p) => p.member_id === m.id && p.day === day)}
                  monthIssues={latesThisMonth(m.id)}
                  monthStart={monthStart}
                />
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {editingHours && <HoursDialog member={editingHours} hours={(hours.data ?? []).filter((h) => h.member_id === editingHours.id)} onClose={() => setEditingHours(null)} />}
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
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [arrived, setArrived] = useState(hhmm(row?.arrived_at))
  const [left, setLeft] = useState(hhmm(row?.left_at))
  const [absent, setAbsent] = useState(row?.absent ?? false)
  const [note, setNote] = useState(row?.note ?? '')
  useEffect(() => {
    setArrived(hhmm(row?.arrived_at))
    setLeft(hhmm(row?.left_at))
    setAbsent(row?.absent ?? false)
    setNote(row?.note ?? '')
  }, [row])

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

  const current = { arrived_at: arrived || null, left_at: left || null, expected_start: expected?.start ?? null, expected_end: expected?.end ?? null }
  const late = lateBy(current)
  const early = earlyBy(current)
  const extra = (() => {
    const l = toMinutes(left)
    const e = toMinutes(expected?.end)
    return l != null && e != null && l - e > GRACE ? l - e : 0
  })()
  const verdicts: Verdict[] = absent
    ? [{ tone: 'danger', label: t('presence.absent') }]
    : [
        ...(late ? [{ tone: 'danger' as Tone, label: t('presence.late', { n: late }) }] : []),
        ...(early ? [{ tone: 'danger' as Tone, label: t('presence.leftEarly', { n: early }) }] : []),
        ...(extra ? [{ tone: 'info' as Tone, label: t('presence.stayed', { n: extra }) }] : []),
        ...(arrived && !late && !early ? [{ tone: 'ok' as Tone, label: t('presence.onTime') }] : []),
      ]
  const dirty =
    arrived !== hhmm(row?.arrived_at) || left !== hhmm(row?.left_at) || absent !== (row?.absent ?? false) || note !== (row?.note ?? '')
  const isToday = day === todayIso()
  const redBg = verdicts.some((v) => v.tone === 'danger')

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
          {expected?.start ? (
            <Tooltip title={expected.usual ? t('presence.usualHours') : t('presence.fromTimetable')}>
              <span>{`${expected.start} → ${expected.end}`}</span>
            </Tooltip>
          ) : (
            <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('presence.noClass')}</Typography>
          )}
          <Tooltip title={t('presence.editHours')}>
            <IconButton size="small" aria-label={`${t('presence.editHours')} — ${name}`} onClick={onEditHours} sx={{ color: expected?.usual ? tokens.accentDark : undefined }}>
              <ScheduleOutlined sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <TextField type="time" value={arrived} onChange={(e) => setArrived(e.target.value)} disabled={absent} sx={{ width: 120 }} slotProps={{ htmlInput: { 'aria-label': `${t('presence.arrival')} — ${name}` } }} />
          {isToday && !arrived && !absent && (
            <Tooltip title={t('presence.arrivedNow')}>
              <IconButton
                size="small"
                aria-label={`${t('presence.arrivedNow')} — ${name}`}
                onClick={() => {
                  const n = nowTime()
                  setArrived(n)
                  save.mutate({ arrived: n })
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
          <TextField type="time" value={left} onChange={(e) => setLeft(e.target.value)} disabled={absent} sx={{ width: 120 }} slotProps={{ htmlInput: { 'aria-label': `${t('presence.departure')} — ${name}` } }} />
          {isToday && arrived && !left && !absent && (
            <Tooltip title={t('presence.leftNow')}>
              <IconButton
                size="small"
                aria-label={`${t('presence.leftNow')} — ${name}`}
                onClick={() => {
                  const n = nowTime()
                  setLeft(n)
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
          placeholder={t('presence.note')}
          variant="standard"
          fullWidth
          sx={{ mt: 0.5, minWidth: 160 }}
          slotProps={{ htmlInput: { 'aria-label': `${t('presence.note')} — ${name}` } }}
        />
      </TableCell>
      <TableCell>
        <Tag tone={monthIssues >= EXCESSIVE_LATES ? 'danger' : monthIssues > 0 ? 'warn' : 'neutral'} label={monthIssues >= EXCESSIVE_LATES ? t('presence.excessive', { n: monthIssues }) : String(monthIssues)} />
      </TableCell>
      <TableCell align="right">
        <Button size="small" variant={dirty ? 'contained' : 'text'} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>
          {t('common.save')}
        </Button>
        {save.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage(save.error, t)}
          </Alert>
        )}
      </TableCell>
    </TableRow>
  )
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

// A teacher's usual arrival and departure, per weekday. An empty day follows
// the timetable (first and last session).
function HoursDialog({ member, hours, onClose }: { member: MemberRow; hours: Hours[]; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Record<number, { start: string; end: string }>>(() =>
    Object.fromEntries(WEEKDAYS.map((d) => {
      const h = hours.find((x) => x.weekday === d)
      return [d, { start: hhmm(h?.starts_at), end: hhmm(h?.ends_at) }]
    })),
  )
  // 2024-01-01 was a Monday
  const dayName = (d: number) => new Date(2024, 0, d).toLocaleDateString(locale, { weekday: 'long' })
  const set = (d: number, k: 'start' | 'end', v: string) => setRows((r) => ({ ...r, [d]: { ...r[d], [k]: v } }))
  const invalid = WEEKDAYS.filter((d) => {
    const { start, end } = rows[d]
    return (!!start !== !!end) || (start && end && end <= start)
  })
  const save = useMutation({
    mutationFn: async () => {
      const filled = WEEKDAYS.filter((d) => rows[d].start && rows[d].end)
      const cleared = WEEKDAYS.filter((d) => !rows[d].start && !rows[d].end)
      if (filled.length)
        must(
          await supabase.from('staff_hours').upsert(
            filled.map((d) => ({ school_id: ctx.school.id, member_id: member.id, weekday: d, starts_at: rows[d].start, ends_at: rows[d].end })),
            { onConflict: 'member_id,weekday' },
          ),
        )
      if (cleared.length) must(await supabase.from('staff_hours').delete().eq('member_id', member.id).in('weekday', cleared))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'staff-hours'] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('presence.hoursTitle', { name: member.user?.full_name ?? '' })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('presence.hoursHint')}
        </Typography>
        <Stack spacing={1.25}>
          {WEEKDAYS.map((d) => (
            <Stack key={d} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography sx={{ width: 90, textTransform: 'capitalize', fontSize: 14 }}>{dayName(d)}</Typography>
              <TextField type="time" size="small" value={rows[d].start} onChange={(e) => set(d, 'start', e.target.value)} error={invalid.includes(d)} slotProps={{ htmlInput: { 'aria-label': `${dayName(d)} — ${t('presence.arrival')}` } }} />
              <Typography color="text.secondary">→</Typography>
              <TextField type="time" size="small" value={rows[d].end} onChange={(e) => set(d, 'end', e.target.value)} error={invalid.includes(d)} slotProps={{ htmlInput: { 'aria-label': `${dayName(d)} — ${t('presence.departure')}` } }} />
            </Stack>
          ))}
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
