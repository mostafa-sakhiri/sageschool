import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
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
import { Tag, initials, type Tone } from '#/components/ui'
import { EmptyState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatPhone, hhmm, nowTime, todayIso, toMinutes } from '#/lib/format'
import { membersQuery } from '#/features/team/api'
import type { TeacherSession } from '#/features/timetable/api'
import { tokens } from '#/theme/theme'

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

// The secrétariat notes when each teacher arrives and leaves. Compared with the
// day's timetable (first and last session): late arrivals, early departures and
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
  const expected = useQuery({
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
                  expected={expected.data?.[m.id]}
                  row={(presence.data ?? []).find((p) => p.member_id === m.id && p.day === day)}
                  monthIssues={latesThisMonth(m.id)}
                  monthStart={monthStart}
                />
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </>
  )
}

function PresenceRow({
  memberId,
  name,
  phone,
  day,
  expected,
  row,
  monthIssues,
  monthStart,
}: {
  memberId: string
  name: string
  phone: string | null
  day: string
  expected?: { start: string | null; end: string | null; count: number }
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
            {phone && (
              <Typography dir="ltr" sx={{ fontSize: 12, color: tokens.inkMuted, textAlign: 'start' }}>
                {formatPhone(phone)}
              </Typography>
            )}
          </div>
        </Stack>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap', color: tokens.inkSoft }}>
        {expected?.count ? `${expected.start} → ${expected.end}` : <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('presence.noClass')}</Typography>}
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
