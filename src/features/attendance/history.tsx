import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import { Tag } from '#/components/ui'
import { EmptyState, Loading } from '#/components/states'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, hhmm, todayIso } from '#/lib/format'
import { useSchool, type SchoolCtx } from '#/lib/session'
import { tokens } from '#/theme/theme'

// Minutes of grace before an arrival counts as late (or a departure as early)
export const GRACE = 5

// The period counted: the school year being viewed, up to today
export function yearPeriod(ctx: SchoolCtx) {
  const today = todayIso()
  if (ctx.year) return { from: ctx.year.starts_on, to: ctx.year.ends_on < today ? ctx.year.ends_on : today }
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) >= 9 ? 0 : 1)
  return { from: `${y}-09-01`, to: today }
}

// ------------------------------------------------------------ students

export type StudentAbsences = { days: number; unjustified_days: number; lates: number }

export const studentAbsencesQuery = (schoolId: string, from: string, to: string) => ({
  queryKey: ['school', schoolId, 'absence-summary', from, to],
  queryFn: async () =>
    Object.fromEntries(
      (must(await supabase.rpc('student_absence_summary', { p_school_id: schoolId, p_from: from, p_to: to })) ?? []).map((r) => [r.student_id, r]),
    ) as Record<string, StudentAbsences>,
})

// "5 j · 2 non justifiés" — a button that opens the detail
export function AbsenceCount({ summary, onOpen }: { summary?: StudentAbsences; onOpen: () => void }) {
  const { t } = useI18n()
  if (!summary || (summary.days === 0 && summary.lates === 0)) return <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>0</Typography>
  return (
    <ButtonBase
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-start', borderRadius: '6px', p: 0.25, '&:hover': { bgcolor: tokens.fill } }}
    >
      <Tag label={t('abs.days', { n: summary.days })} tone={summary.days ? 'neutral' : 'ok'} />
      {summary.unjustified_days > 0 && <Tag tone="danger" label={t('abs.unjustified', { n: summary.unjustified_days })} />}
      {summary.lates > 0 && <Tag tone="warn" label={t('abs.lates', { n: summary.lates })} />}
    </ButtonBase>
  )
}

type Record_ = {
  id: string
  session_date: string
  status: 'absent' | 'late' | 'excused'
  justification: string | null
  parent_notified_at: string | null
  slot: { starts_at: string; ends_at: string; subject: { name: string } | null } | null
}

// A student's absences and late arrivals over the year, day by day: the
// sessions missed, justified or not (and why), parents told or not. Whoever
// takes the roll of every class can justify a day.
export function StudentAbsencesDialog({ studentId, name, onClose }: { studentId: string; name: string; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const { from, to } = yearPeriod(ctx)
  const [filter, setFilter] = useState<'all' | 'unjustified'>('all')
  const [justifying, setJustifying] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const records = useQuery({
    queryKey: ['school', ctx.school.id, 'absences-of', studentId, from, to],
    queryFn: async () =>
      must(
        await supabase
          .from('attendance_records')
          .select('id, session_date, status, justification, parent_notified_at, slot:timetable_slots(starts_at, ends_at, subject:subjects(name))')
          .eq('student_id', studentId)
          .neq('status', 'present')
          .gte('session_date', from)
          .lte('session_date', to)
          .order('session_date', { ascending: false }),
      ) as unknown as Record_[],
  })
  const justify = useMutation({
    mutationFn: async (date: string) =>
      must(
        await supabase
          .from('attendance_records')
          .update({ status: 'excused', justification: reason.trim(), justified_at: new Date().toISOString() })
          .eq('student_id', studentId)
          .eq('session_date', date)
          .in('status', ['absent', 'late']),
      ),
    onSuccess: async () => {
      setJustifying(null)
      setReason('')
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
    },
  })

  const byDay = new Map<string, Record_[]>()
  for (const r of records.data ?? []) byDay.set(r.session_date, [...(byDay.get(r.session_date) ?? []), r])
  const days = [...byDay.entries()].filter(([, rs]) => filter === 'all' || rs.some((r) => r.status === 'absent' || r.status === 'late'))
  const canJustify = ctx.can('attendance.take_all')

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          {t('abs.titleOf', { name })}
          <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('abs.period', { from: formatDate(from, locale), to: formatDate(to, locale) })}</Typography>
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ mb: 2 }}>
          <ToggleButton value="all">{t('abs.filterAll')}</ToggleButton>
          <ToggleButton value="unjustified">{t('abs.filterUnjustified')}</ToggleButton>
        </ToggleButtonGroup>
        {records.isPending ? (
          <Loading rows={4} />
        ) : days.length === 0 ? (
          <EmptyState title={t(filter === 'all' ? 'abs.none' : 'abs.noneUnjustified')} />
        ) : (
          <Stack spacing={1}>
            {days.map(([date, rs]) => {
              const absent = rs.some((r) => r.status === 'absent')
              const late = rs.some((r) => r.status === 'late')
              const excused = rs.every((r) => r.status === 'excused')
              const why = rs.find((r) => r.justification)?.justification
              const notified = rs.some((r) => r.parent_notified_at)
              const sessions = rs
                .filter((r) => r.slot)
                .sort((a, b) => a.slot!.starts_at.localeCompare(b.slot!.starts_at))
                .map((r) => `${hhmm(r.slot!.starts_at)} ${r.slot!.subject?.name ?? ''}`.trim())
              return (
                <Box key={date} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${excused ? tokens.lineSoft : absent ? tokens.dangerLine : tokens.warnLine}` }}>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 160 }}>
                      {formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                    </Typography>
                    {excused ? (
                      <Tag tone="ok" label={t('abs.justified')} />
                    ) : absent ? (
                      <Tag tone="danger" label={t('abs.absentUnjustified')} />
                    ) : late ? (
                      <Tag tone="warn" label={t('abs.late')} />
                    ) : null}
                    {(absent || late) && <Tag tone={notified ? 'info' : 'neutral'} label={notified ? t('abs.parentsTold') : t('abs.parentsNotTold')} />}
                  </Stack>
                  <Typography sx={{ fontSize: 13, color: tokens.inkMuted, mt: 0.5 }}>
                    {sessions.length ? sessions.join(' · ') : t('abs.wholeDay')}
                  </Typography>
                  {why && <Typography sx={{ fontSize: 13, mt: 0.5 }}>{t('abs.reason', { why })}</Typography>}
                  {canJustify && !excused && justifying !== date && (
                    <Button size="small" onClick={() => (setJustifying(date), setReason(''))} sx={{ mt: 0.5, px: 0 }}>
                      {t('abs.justify')}
                    </Button>
                  )}
                  {justifying === date && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
                      <TextField
                        size="small"
                        autoFocus
                        fullWidth
                        placeholder={t('abs.reasonPlaceholder')}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && reason.trim() && justify.mutate(date)}
                      />
                      <Button variant="contained" disabled={!reason.trim()} loading={justify.isPending} onClick={() => justify.mutate(date)}>
                        {t('common.save')}
                      </Button>
                    </Stack>
                  )}
                </Box>
              )
            })}
          </Stack>
        )}
        {justify.isError && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(justify.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------------------- staff

export type StaffIncident = {
  id: string
  member_id: string
  day: string
  absent: boolean
  late_minutes: number
  early_minutes: number
  justified: boolean
  note: string | null
}

export const staffIncidentsQuery = (schoolId: string, from: string, to: string) => ({
  queryKey: ['school', schoolId, 'staff-incidents', from, to],
  queryFn: async () =>
    (must(await supabase.rpc('staff_incidents', { p_school_id: schoolId, p_from: from, p_to: to, p_grace: GRACE })) ?? []) as StaffIncident[],
})

export function summarizeStaff(rows: StaffIncident[]) {
  return {
    absences: rows.filter((r) => r.absent).length,
    lates: rows.filter((r) => r.late_minutes > 0).length,
    early: rows.filter((r) => r.early_minutes > 0).length,
    unjustified: rows.filter((r) => !r.justified).length,
  }
}

export function StaffIncidentCount({ rows, onOpen }: { rows: StaffIncident[]; onOpen: () => void }) {
  const { t } = useI18n()
  if (!rows.length) return <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>0</Typography>
  const s = summarizeStaff(rows)
  return (
    <ButtonBase
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-start', borderRadius: '6px', p: 0.25, '&:hover': { bgcolor: tokens.fill } }}
    >
      {s.absences > 0 && <Tag label={t('abs.days', { n: s.absences })} />}
      {s.lates > 0 && <Tag tone="warn" label={t('abs.lates', { n: s.lates })} />}
      {s.early > 0 && <Tag tone="warn" label={t('abs.early', { n: s.early })} />}
      {s.unjustified > 0 && <Tag tone="danger" label={t('abs.unjustified', { n: s.unjustified })} />}
    </ButtonBase>
  )
}

// A teacher's absences, late arrivals and early departures over the year,
// justified or not; the secrétariat can mark one justified and say why.
export function StaffIncidentsDialog({ memberId, name, onClose }: { memberId: string; name: string; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const { from, to } = yearPeriod(ctx)
  const [filter, setFilter] = useState<'all' | 'unjustified'>('all')
  const incidents = useQuery(staffIncidentsQuery(ctx.school.id, from, to))
  const mine = (incidents.data ?? []).filter((r) => r.member_id === memberId && (filter === 'all' || !r.justified))
  const canEdit = ctx.can('staff_presence.record')
  const save = useMutation({
    mutationFn: async ({ id, justified, note }: { id: string; justified?: boolean; note?: string }) =>
      must(
        await supabase
          .from('staff_presence')
          .update({ ...(justified === undefined ? {} : { justified }), ...(note === undefined ? {} : { note: note.trim() || null }) })
          .eq('id', id),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] }),
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          {t('abs.titleOf', { name })}
          <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('abs.period', { from: formatDate(from, locale), to: formatDate(to, locale) })}</Typography>
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ mb: 2 }}>
          <ToggleButton value="all">{t('abs.filterAll')}</ToggleButton>
          <ToggleButton value="unjustified">{t('abs.filterUnjustified')}</ToggleButton>
        </ToggleButtonGroup>
        {incidents.isPending ? (
          <Loading rows={4} />
        ) : mine.length === 0 ? (
          <EmptyState title={t(filter === 'all' ? 'abs.noneStaff' : 'abs.noneUnjustified')} />
        ) : (
          <Stack spacing={1}>
            {mine.map((r) => (
              <StaffIncidentRow key={r.id} r={r} canEdit={canEdit} onSave={(patch) => save.mutate({ id: r.id, ...patch })} locale={locale} />
            ))}
          </Stack>
        )}
        {save.isError && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(save.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

function StaffIncidentRow({
  r,
  canEdit,
  onSave,
  locale,
}: {
  r: StaffIncident
  canEdit: boolean
  onSave: (patch: { justified?: boolean; note?: string }) => void
  locale: Parameters<typeof formatDate>[1]
}) {
  const { t } = useI18n()
  const [note, setNote] = useState(r.note ?? '')
  return (
    <Box sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${r.justified ? tokens.lineSoft : tokens.dangerLine}` }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 160 }}>
          {formatDate(r.day, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </Typography>
        {r.absent && <Tag tone="danger" label={t('presence.absent')} />}
        {r.late_minutes > 0 && <Tag tone="warn" label={t('presence.late', { n: r.late_minutes })} />}
        {r.early_minutes > 0 && <Tag tone="warn" label={t('presence.leftEarly', { n: r.early_minutes })} />}
        {canEdit ? (
          <FormControlLabel
            control={<Switch size="small" checked={r.justified} onChange={(e) => onSave({ justified: e.target.checked })} />}
            label={<Typography sx={{ fontSize: 13 }}>{t('abs.justified')}</Typography>}
            sx={{ m: 0 }}
          />
        ) : (
          <Tag tone={r.justified ? 'ok' : 'neutral'} label={r.justified ? t('abs.justified') : t('abs.notJustified')} />
        )}
      </Stack>
      {canEdit ? (
        <TextField
          variant="standard"
          fullWidth
          value={note}
          placeholder={t('presence.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (r.note ?? '') && onSave({ note })}
          sx={{ mt: 0.75 }}
        />
      ) : (
        r.note && <Typography sx={{ fontSize: 13, mt: 0.5 }}>{r.note}</Typography>
      )}
    </Box>
  )
}
