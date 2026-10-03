import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, SectionTitle, Tag, type Tone } from '#/components/ui'
import { EmptyState, ErrorState, Loading, NotFound } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { addDays, formatDate, formatPhone, isoWeekday, mondayOf, todayIso } from '#/lib/format'
import { WeekGrid, type Block } from '#/features/timetable/WeekGrid'
import { WeekNav, useSchoolDays } from '#/features/timetable/RealWeek'
import { membersQuery } from '#/features/team/api'
import { subjectTokens, tokens } from '#/theme/theme'
import { WhatsAppButton } from '#/components/WhatsApp'
import {
  AppointmentDialog,
  KINDS,
  localDate,
  localTime,
  plusMinutes,
  toIso,
  type Appointment,
  type Kind,
  type Status,
} from '#/features/agenda/AppointmentDialog'

export const Route = createFileRoute('/_app/agenda')({
  // ?new=1 opens the dialog (quick actions); ?preinscription=<id> prefills an enrolment visit
  validateSearch: (s: Record<string, unknown>): { new?: boolean; preinscription?: string } => ({
    new: s.new === true || s.new === 1 || s.new === '1' || undefined,
    preinscription: typeof s.preinscription === 'string' ? s.preinscription : undefined,
  }),
  component: AgendaPage,
})

const STATUS_TONE: Record<Status, Tone> = { planned: 'info', done: 'ok', no_show: 'danger', cancelled: 'neutral' }
const KIND_COLOR: Record<Kind, number> = { visit_parent: 0, visit_student: 2, visit_prospect: 1, enrollment: 4, meeting: 6, other: 7 }

function AgendaPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const search = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  const { days: schoolDays, start, end } = useSchoolDays()
  const [monday, setMonday] = useState(mondayOf(todayIso()))
  const [editing, setEditing] = useState<Partial<Appointment> | null>(null)
  const canRead = ctx.can('agenda.view')
  const canWrite = ctx.can('agenda.manage')
  const members = useQuery(membersQuery(ctx.school.id))
  const names = Object.fromEntries((members.data ?? []).map((m) => [m.id, m.user?.full_name ?? '']))

  const week = useQuery({
    enabled: canRead,
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
    if (!canWrite) {
      navigateSelf({ search: {}, replace: true })
      return
    }
    const open = async () => {
      if (search.preinscription) {
        const p = must(
          await supabase.from('preinscriptions').select('id, child_first_name, child_last_name, parent_name, parent_phone').eq('id', search.preinscription).single(),
        )
        setEditing({
          kind: 'visit_prospect',
          preinscription_id: p.id,
          visitor_name: p.parent_name,
          visitor_phone: p.parent_phone,
          title: t('agenda.prospectTitle', { name: `${p.child_first_name} ${p.child_last_name}` }),
        })
      } else setEditing({})
      navigateSelf({ search: {}, replace: true })
    }
    void open()
  }, [search.new, search.preinscription, navigateSelf, t, canWrite])

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

  if (!canRead)
    return (
      <AppShell title={t('nav.agenda')}>
        <NotFound />
      </AppShell>
    )

  return (
    <AppShell title={t('nav.agenda')}>
      <PageIntro
        title={t('agenda.title')}
        subtitle={t('agenda.subtitle')}
        actions={
          canWrite && (
            <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing({})}>
              {t('agenda.new')}
            </Button>
          )
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
            onEmptyClick={!canWrite ? undefined : (d, time) => setEditing({ starts_at: toIso(addDays(monday, d - 1), time), ends_at: toIso(addDays(monday, d - 1), plusMinutes(time, 30)) })}
          />
        )}
        {canWrite && (
          <Typography variant="body2" color="text.secondary">
            {t('agenda.clickHint')}
          </Typography>
        )}
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
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const canWrite = ctx.can('agenda.manage')
  const navigate = useNavigate()
  const toPrereg = () =>
    navigate({ to: '/preregistrations', search: { new: true, parent: a.visitor_name ?? undefined, phone: a.visitor_phone ?? undefined, appointment: a.id } })
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
        <WhatsAppButton
          phone={a.visitor_phone}
          tooltip={t('wa.appointmentTooltip')}
          text={t('wa.appointment', { name: a.visitor_name ?? '', date: formatDate(localDate(a.starts_at), locale, { weekday: 'long', day: 'numeric', month: 'long' }), time: localTime(a.starts_at), school: ctx.school.name })}
        />
      )}
      {canWrite && ctx.can('preregistrations.manage') && a.kind === 'visit_prospect' && !a.preinscription_id && (
        <Button size="small" startIcon={<HowToRegOutlined />} onClick={toPrereg}>
          {t('agenda.toPrereg')}
        </Button>
      )}
      {canWrite && a.status === 'planned' && (
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
