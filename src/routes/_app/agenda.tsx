import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, SectionTitle, Tag, fullName, type Tone } from '#/components/ui'
import { EmptyState, ErrorState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { addDays, formatDate, formatPhone, isoWeekday, mondayOf, normalizePhone, todayIso } from '#/lib/format'
import { WeekGrid, type Block } from '#/features/timetable/WeekGrid'
import { WeekNav, useSchoolDays } from '#/features/timetable/RealWeek'
import { studentsQuery } from '#/features/students/api'
import { membersQuery } from '#/features/team/api'
import { subjectTokens, tokens } from '#/theme/theme'

export const Route = createFileRoute('/_app/agenda')({
  // ?new=1 opens the dialog (quick actions); ?preinscription=<id> prefills an enrolment visit
  validateSearch: (s: Record<string, unknown>): { new?: boolean; preinscription?: string } => ({
    new: s.new === true || s.new === 1 || s.new === '1' || undefined,
    preinscription: typeof s.preinscription === 'string' ? s.preinscription : undefined,
  }),
  component: AgendaPage,
})

const KINDS = ['visit_parent', 'visit_student', 'enrollment', 'meeting', 'other'] as const
type Kind = (typeof KINDS)[number]
const STATUSES = ['planned', 'done', 'no_show', 'cancelled'] as const
type Status = (typeof STATUSES)[number]
const STATUS_TONE: Record<Status, Tone> = { planned: 'info', done: 'ok', no_show: 'danger', cancelled: 'neutral' }
const KIND_COLOR: Record<Kind, number> = { visit_parent: 0, visit_student: 2, enrollment: 4, meeting: 6, other: 7 }

export type Appointment = {
  id: string
  kind: Kind
  title: string
  starts_at: string
  ends_at: string
  visitor_name: string | null
  visitor_phone: string | null
  student_id: string | null
  preinscription_id: string | null
  host_member_id: string | null
  notes: string | null
  status: Status
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const localTime = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toIso = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString()
const plusMinutes = (time: string, n: number) => {
  const [h, m] = time.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, h * 60 + m + n)
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
}

function AgendaPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const search = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  const { days: schoolDays, start, end } = useSchoolDays()
  const [monday, setMonday] = useState(mondayOf(todayIso()))
  const [editing, setEditing] = useState<Partial<Appointment> | null>(null)
  const members = useQuery(membersQuery(ctx.school.id))
  const names = Object.fromEntries((members.data ?? []).map((m) => [m.id, m.user?.full_name ?? '']))

  const week = useQuery({
    queryKey: ['school', ctx.school.id, 'appointments', monday],
    queryFn: async () =>
      must(
        await supabase
          .from('appointments')
          .select('id, kind, title, starts_at, ends_at, visitor_name, visitor_phone, student_id, preinscription_id, host_member_id, notes, status')
          .eq('school_id', ctx.school.id)
          .gte('starts_at', new Date(`${monday}T00:00:00`).toISOString())
          .lt('starts_at', new Date(`${addDays(monday, 7)}T00:00:00`).toISOString())
          .order('starts_at'),
      ) as Appointment[],
  })

  // Quick action / pre-registration: open the dialog once, then clean the URL
  useEffect(() => {
    if (!search.new && !search.preinscription) return
    const open = async () => {
      if (search.preinscription) {
        const p = must(
          await supabase.from('preinscriptions').select('id, child_first_name, child_last_name, parent_name, parent_phone').eq('id', search.preinscription).single(),
        )
        setEditing({
          kind: 'enrollment',
          preinscription_id: p.id,
          visitor_name: p.parent_name,
          visitor_phone: p.parent_phone,
          title: t('agenda.enrollmentTitle', { name: `${p.child_first_name} ${p.child_last_name}` }),
        })
      } else setEditing({})
      navigateSelf({ search: {}, replace: true })
    }
    void open()
  }, [search.new, search.preinscription, navigateSelf, t])

  // Saturday mornings etc.: show any day that has an appointment
  const days = useMemo(() => {
    const set = new Set(schoolDays)
    for (const a of week.data ?? []) set.add(isoWeekday(localDate(a.starts_at)))
    return [...set].sort()
  }, [schoolDays, week.data])
  const dayNames = t('setup.dayNames').split(',')
  const labels = Object.fromEntries(days.map((d) => [d, `${dayNames[d - 1]} ${formatDate(addDays(monday, d - 1), locale, { day: 'numeric', month: 'short' })}`]))
  const blocks: Block[] = (week.data ?? []).map((a) => ({
    key: a.id,
    weekday: isoWeekday(localDate(a.starts_at)),
    start: localTime(a.starts_at),
    end: localTime(a.ends_at),
    title: a.title,
    lines: [a.visitor_name ? `${a.visitor_name}${a.visitor_phone ? ` · ${formatPhone(a.visitor_phone)}` : ''}` : '', a.host_member_id ? names[a.host_member_id] : ''].filter(Boolean),
    color: subjectTokens(KIND_COLOR[a.kind]),
    strike: a.status === 'cancelled' || a.status === 'no_show',
    badge: a.status === 'done' ? t('agenda.status.done') : undefined,
    onClick: () => setEditing(a),
  }))
  const today = todayIso()
  const todays = (week.data ?? []).filter((a) => localDate(a.starts_at) === today)

  return (
    <AppShell title={t('nav.agenda')}>
      <PageIntro
        title={t('agenda.title')}
        subtitle={t('agenda.subtitle')}
        actions={
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing({})}>
            {t('agenda.new')}
          </Button>
        }
      />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <WeekNav monday={monday} onChange={setMonday} />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {KINDS.map((k) => (
              <Stack key={k} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: subjectTokens(KIND_COLOR[k]).ink }} />
                <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{t(`agenda.kind.${k}`)}</Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
        {week.isPending ? (
          <Loading rows={4} />
        ) : week.isError ? (
          <ErrorState error={week.error} onRetry={() => week.refetch()} />
        ) : (
          <WeekGrid
            days={days}
            dayLabels={labels}
            blocks={blocks}
            dayStart={start}
            dayEnd={end}
            onEmptyClick={(d, time) => setEditing({ starts_at: toIso(addDays(monday, d - 1), time), ends_at: toIso(addDays(monday, d - 1), plusMinutes(time, 30)) })}
          />
        )}
        <Typography variant="body2" color="text.secondary">
          {t('agenda.clickHint')}
        </Typography>
        {monday === mondayOf(today) && (
          <>
            <SectionTitle>{t('agenda.today')}</SectionTitle>
            {todays.length === 0 ? (
              <EmptyState title={t('agenda.noneToday')} />
            ) : (
              <Stack spacing={1}>
                {todays.map((a) => (
                  <TodayRow key={a.id} a={a} host={a.host_member_id ? names[a.host_member_id] : undefined} onOpen={() => setEditing(a)} />
                ))}
              </Stack>
            )}
          </>
        )}
      </Stack>
      {editing && <AppointmentDialog initial={editing} onClose={() => setEditing(null)} />}
    </AppShell>
  )
}

function TodayRow({ a, host, onOpen }: { a: Appointment; host?: string; onOpen: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const setStatus = useMutation({
    mutationFn: async (status: Status) => must(await supabase.from('appointments').update({ status }).eq('id', a.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'appointments'] }),
  })
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
      <Typography sx={{ fontWeight: 600, width: 100, color: tokens.inkSoft }}>
        {localTime(a.starts_at)}–{localTime(a.ends_at)}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
        <Typography sx={{ fontWeight: 600 }}>{a.title}</Typography>
        <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>
          {[t(`agenda.kind.${a.kind}`), a.visitor_name, formatPhone(a.visitor_phone), host].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <Tag tone={STATUS_TONE[a.status]} label={t(`agenda.status.${a.status}`)} />
      {a.status === 'planned' && (
        <Stack direction="row" spacing={0.5}>
          <Button size="small" variant="outlined" onClick={() => setStatus.mutate('done')} loading={setStatus.isPending}>
            {t('agenda.markDone')}
          </Button>
          <Button size="small" color="error" onClick={() => setStatus.mutate('no_show')}>
            {t('agenda.markNoShow')}
          </Button>
        </Stack>
      )}
    </Paper>
  )
}

function AppointmentDialog({ initial, onClose }: { initial: Partial<Appointment>; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const students = useQuery(studentsQuery(ctx.school.id))
  const members = useQuery(membersQuery(ctx.school.id))
  const hosts = (members.data ?? []).filter((m) => (m.role === 'admin' || m.role === 'staff') && m.status === 'active')
  const now = new Date()
  const defaultStart = `${pad(Math.min(17, Math.max(8, now.getHours() + 1)))}:00`
  const [kind, setKind] = useState<Kind>(initial.kind ?? 'visit_parent')
  const [title, setTitle] = useState(initial.title ?? '')
  const [date, setDate] = useState(initial.starts_at ? localDate(initial.starts_at) : todayIso())
  const [startTime, setStartTime] = useState(initial.starts_at ? localTime(initial.starts_at) : defaultStart)
  const [endTime, setEndTime] = useState(initial.ends_at ? localTime(initial.ends_at) : plusMinutes(defaultStart, 30))
  const [visitor, setVisitor] = useState(initial.visitor_name ?? '')
  const [phone, setPhone] = useState(initial.visitor_phone ?? '')
  const [studentId, setStudentId] = useState<string | null>(initial.student_id ?? null)
  const [hostId, setHostId] = useState(initial.host_member_id ?? (ctx.isAdmin ? ctx.member.id : ''))
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [status, setStatus] = useState<Status>(initial.status ?? 'planned')
  const isEdit = !!initial.id

  // A student picked: the visitor defaults to their first parent
  const pickStudent = (id: string | null) => {
    setStudentId(id)
    const s = students.data?.find((x) => x.id === id)
    const g = s?.guardians[0]?.member?.user
    if (s && g && !visitor) {
      setVisitor(g.full_name)
      setPhone(g.phone ?? '')
    }
    if (s && !title) setTitle(t(`agenda.kind.${kind}`) + ' — ' + fullName(s))
  }

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        kind,
        title: title.trim() || `${t(`agenda.kind.${kind}`)}${visitor ? ` — ${visitor}` : ''}`,
        starts_at: toIso(date, startTime),
        ends_at: toIso(date, endTime),
        visitor_name: visitor.trim() || null,
        visitor_phone: normalizePhone(phone) || null,
        student_id: studentId,
        host_member_id: hostId || null,
        notes: notes.trim() || null,
        status,
      }
      if (isEdit) must(await supabase.from('appointments').update(row).eq('id', initial.id!))
      else {
        must(
          await supabase
            .from('appointments')
            .insert({ ...row, school_id: ctx.school.id, preinscription_id: initial.preinscription_id ?? null, created_by_member_id: ctx.member.id }),
        )
        if (initial.preinscription_id)
          must(await supabase.from('preinscriptions').update({ status: 'visit_planned' }).eq('id', initial.preinscription_id).in('status', ['new', 'contacted', 'waiting']))
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('appointments').delete().eq('id', initial.id!)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'appointments'] })
      onClose()
    },
  })
  const invalidTime = endTime <= startTime

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogTitle>{isEdit ? t('agenda.edit') : t('agenda.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label={t('agenda.kindLabel')} value={kind} onChange={(e) => setKind(e.target.value as Kind)} sx={{ minWidth: 200 }}>
                {KINDS.map((k) => (
                  <MenuItem key={k} value={k}>
                    {t(`agenda.kind.${k}`)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label={t('agenda.titleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth placeholder={t('agenda.titlePlaceholder')} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField type="date" label={t('common.date')} value={date} onChange={(e) => setDate(e.target.value)} required slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              <TextField
                type="time"
                label={t('agenda.from')}
                value={startTime}
                onChange={(e) => {
                  const v = e.target.value
                  setStartTime(v)
                  if (endTime <= v) setEndTime(plusMinutes(v, 30))
                }}
                required
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField type="time" label={t('agenda.to')} value={endTime} onChange={(e) => setEndTime(e.target.value)} required error={invalidTime} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            </Stack>
            <Autocomplete
              options={students.data ?? []}
              value={(students.data ?? []).find((s) => s.id === studentId) ?? null}
              onChange={(_, v) => pickStudent(v?.id ?? null)}
              getOptionLabel={(s) => fullName(s)}
              renderInput={(params) => <TextField {...params} label={t('agenda.student')} helperText={t('agenda.studentHint')} />}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('agenda.visitor')} value={visitor} onChange={(e) => setVisitor(e.target.value)} fullWidth />
              <TextField label={t('common.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth slotProps={{ htmlInput: { dir: 'ltr' } }} />
            </Stack>
            <TextField select label={t('agenda.host')} value={hostId} onChange={(e) => setHostId(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">—</MenuItem>
              {hosts.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.user?.full_name} · {t(`role.${m.role}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField label={t('agenda.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
            {isEdit && (
              <TextField select label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`agenda.status.${s}`)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {invalidTime && <Alert severity="warning">{t('agenda.badTime')}</Alert>}
            {(save.isError || remove.isError) && <Alert severity="error">{errorMessage(save.error ?? remove.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          {isEdit && (
            <Button color="error" onClick={() => remove.mutate()} loading={remove.isPending} sx={{ mr: 'auto' }}>
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={invalidTime || !date}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
