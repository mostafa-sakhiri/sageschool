import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Box, Button, Paper, Stack, Typography } from '@mui/material'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import { AppShell } from '#/components/AppShell'
import { Card, PageIntro, SectionTitle, StatCard, Tag, fullName, initials, type Tone } from '#/components/ui'
import { ErrorState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { addDays, formatDate, formatMoney, hhmm, todayIso } from '#/lib/format'
import { alertsQuery } from '#/features/attendance/api'
import { followupDue, preregsQuery } from '#/features/preregistrations/api'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
import { subjectsQuery } from '#/features/structure/api'
import { membersNamesQuery, subjectColor, type DaySession, type TeacherSession } from '#/features/timetable/api'
import { announcementsQuery, balancesQuery, casesQuery, homeworkQuery } from '#/features/queries'
import { subjectTokens, tokens } from '#/theme/theme'
import { ParentNotified } from '#/features/attendance/ParentNotified'
import { guardiansToRecipients } from '#/components/WhatsApp'
import { AssistantInput } from '#/features/assistant/AssistantInput'

export const Route = createFileRoute('/_app/')({ component: Dashboard })

function Dashboard() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const first = ctx.user.full_name.split(' ')[0]
  return (
    <AppShell title={t('nav.dashboard')}>
      <PageIntro
        title={t('dash.hello', { name: first })}
        subtitle={formatDate(todayIso(), locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />
      {ctx.isOffice && <AssistantInput />}
      {ctx.isOffice ? <OfficeDash /> : ctx.role === 'teacher' ? <TeacherDash /> : ctx.role === 'parent' ? <ParentDash /> : <StudentDash />}
    </AppShell>
  )
}

// Urgency of a to-do, most urgent first:
//   critical: a family is waiting (alert to notify, unanswered message, complaint)
//   high: money or enrolment at stake, or setup that blocks the school
//   info: planned for today
//   low: housekeeping
type Level = 'critical' | 'high' | 'info' | 'low'
type Todo = { key: string; title: string; detail?: string; to: string; search?: Record<string, string>; action: string; level: Level }

const LEVELS: Record<Level, { order: number; bg: string; line: string; bar: string; iconBg: string; ink: string; icon: React.ReactNode; tone: Tone }> = {
  critical: { order: 0, bg: tokens.dangerSoft, line: tokens.dangerLine, bar: tokens.dangerInk, iconBg: tokens.dangerLine, ink: tokens.dangerInk, icon: <ErrorOutlineOutlined fontSize="small" />, tone: 'danger' },
  high: { order: 1, bg: tokens.warnSoft, line: tokens.warnLine, bar: tokens.warn, iconBg: tokens.warnLine, ink: tokens.warnInk, icon: <WarningAmberOutlined fontSize="small" />, tone: 'warn' },
  info: { order: 2, bg: tokens.infoSoft, line: tokens.infoLine, bar: tokens.infoInk, iconBg: tokens.infoLine, ink: tokens.infoInk, icon: <EventOutlined fontSize="small" />, tone: 'info' },
  low: { order: 3, bg: tokens.card, line: tokens.line, bar: tokens.lineStrong, iconBg: tokens.fill, ink: tokens.inkMuted, icon: <ChecklistOutlined fontSize="small" />, tone: 'neutral' },
}

function TodoList({ items }: { items: Todo[] }) {
  const { t } = useI18n()
  if (!items.length)
    return (
      <Paper variant="outlined" sx={{ p: 2.5, bgcolor: tokens.accentSoft, borderColor: tokens.accentLine, display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <CheckOutlined sx={{ color: tokens.accentDark }} />
        <Typography sx={{ color: tokens.accentDark }}>{t('dash.nothing')}</Typography>
      </Paper>
    )
  const sorted = [...items].sort((a, b) => LEVELS[a.level].order - LEVELS[b.level].order)
  return (
    <Stack spacing={1}>
      {sorted.map((a) => {
        const l = LEVELS[a.level]
        return (
          <Paper
            key={a.key}
            variant="outlined"
            sx={{
              p: 2,
              display: 'flex',
              gap: 1.75,
              alignItems: 'center',
              flexWrap: { xs: 'wrap', sm: 'nowrap' },
              bgcolor: l.bg,
              borderColor: l.line,
              borderInlineStart: `3px solid ${l.bar}`,
            }}
          >
            <Box sx={{ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: l.iconBg, color: l.ink, flexShrink: 0 }}>{l.icon}</Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{a.title}</Typography>
                {a.level !== 'low' && <Tag tone={l.tone} label={t(`dash.level.${a.level}`)} />}
              </Stack>
              {a.detail && <Typography sx={{ fontSize: 13, color: tokens.inkSoft }}>{a.detail}</Typography>}
            </Box>
            <Button
              component={Link}
              to={a.to}
              search={a.search as never}
              variant={a.level === 'critical' || a.level === 'high' ? 'contained' : 'outlined'}
              color={a.level === 'critical' ? 'error' : a.level === 'high' ? 'warning' : 'primary'}
              size="small"
            >
              {a.action}
            </Button>
          </Paper>
        )
      })}
    </Stack>
  )
}

function OfficeDash() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const students = useQuery(studentsQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const cases = useQuery(casesQuery(ctx.school.id))
  const balances = useQuery({ ...balancesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year && ctx.canFees })
  const published = useQuery({
    queryKey: ['school', ctx.school.id, 'published-classes'],
    queryFn: async () =>
      new Set(must(await supabase.from('timetable_versions').select('class_id').eq('school_id', ctx.school.id).eq('status', 'published')).map((v) => v.class_id)),
  })
  const today = todayIso()
  const alerts = useQuery(alertsQuery(ctx.school.id))
  const preregs = useQuery(preregsQuery(ctx.school.id))
  const appointments = useQuery({
    queryKey: ['school', ctx.school.id, 'appointments', 'day', today],
    queryFn: async () =>
      must(
        await supabase
          .from('appointments')
          .select('id, title, starts_at, status')
          .eq('school_id', ctx.school.id)
          .eq('status', 'planned')
          .gte('starts_at', new Date(`${today}T00:00:00`).toISOString())
          .lt('starts_at', new Date(`${addDays(today, 1)}T00:00:00`).toISOString())
          .order('starts_at'),
      ),
  })
  const reminders = useQuery({
    queryKey: ['school', ctx.school.id, 'reminders', ctx.year?.id],
    enabled: !!ctx.year && ctx.canFees,
    queryFn: async () =>
      Object.fromEntries(
        must(await supabase.from('installment_reminders').select('installment_id, last_reminded_at, reminder_count')).map((r) => [r.installment_id, r]),
      ) as Record<string, { last_reminded_at: string | null; reminder_count: number | null }>,
  })
  const absences = useQuery({
    queryKey: ['school', ctx.school.id, 'absences-day', today],
    queryFn: async () =>
      must(
        await supabase
          .from('attendance_records')
          .select('id, student_id, session_date, status, justification, parent_notified_at, student:students(first_name, last_name), class:classes(name)')
          .eq('school_id', ctx.school.id)
          .eq('session_date', today)
          .neq('status', 'present'),
      ) as unknown as { id: string; student_id: string; session_date: string; status: string; parent_notified_at: string | null; student: { first_name: string; last_name: string }; class: { name: string } }[],
  })

  if (!ctx.year)
    return (
      <TodoList items={[{ key: 'year', title: t('year.none'), detail: t('year.noneHint'), to: '/setup', action: t('dash.createYear'), level: 'high' as const }]} />
    )
  if (students.isPending || classes.isPending) return <Loading rows={5} />
  if (students.isError || classes.isError) return <ErrorState error={students.error ?? classes.error} onRetry={() => (students.refetch(), classes.refetch())} />

  const studentRows = students.data ?? []
  const classRows = classes.data ?? []
  const unplaced = studentRows.filter((s) => s.status === 'active' && !currentEnrollment(s, ctx.year?.id))
  const noTimetable = classRows.filter((c) => !published.data?.has(c.id))
  // Only this year's classes count (the query covers every year of the school).
  const publishedCount = classRows.filter((c) => published.data?.has(c.id)).length
  const forAdmin = (cases.data ?? []).filter((c) => c.for_admin && c.status !== 'resolved')
  // The admin sees complaints addressed to them in their own line, not twice
  const openCases = (cases.data ?? []).filter((c) => c.status === 'open' && !(ctx.isAdmin && c.for_admin))
  const openAlerts = (alerts.data ?? []).filter((a) => a.status === 'open')
  const dueFollowups = (preregs.data ?? []).filter((p) => followupDue(p, today))
  const notReminded = (balances.data ?? []).filter((b) => b.payment_status === 'overdue' && !reminders.data?.[b.id])
  const overdue = (balances.data ?? []).filter((b) => b.payment_status === 'overdue')
  const noParent = studentRows.filter((s) => s.guardians.length === 0)

  const nameOf = (id: string) => fullName(studentRows.find((s) => s.id === id))
  const todos: Todo[] = [
    ...(openAlerts.length
      ? [{ key: 'alerts', title: t('dash.openAlerts', { n: openAlerts.length }), detail: openAlerts.slice(0, 3).map((a) => nameOf(a.student_id)).join(', '), to: '/attendance', search: { tab: 'alerts' }, action: t('dash.notifyParents'), level: 'critical' as const }]
      : []),
    ...(ctx.isAdmin && forAdmin.length
      ? [{ key: 'forAdmin', title: t('dash.complaintsForAdmin', { n: forAdmin.length }), detail: forAdmin[0].subject, to: '/cases', action: t('dash.answer'), level: 'critical' as const }]
      : []),
    ...((appointments.data ?? []).length
      ? [{ key: 'agenda', title: t('dash.appointmentsToday', { n: appointments.data!.length }), detail: appointments.data!.slice(0, 3).map((a) => `${new Date(a.starts_at).toTimeString().slice(0, 5)} ${a.title}`).join(' · '), to: '/agenda', action: t('dash.seeAgenda'), level: 'info' as const }]
      : []),
    ...(dueFollowups.length
      ? [{ key: 'prereg', title: t('dash.followupsDue', { n: dueFollowups.length }), detail: dueFollowups.slice(0, 3).map((p) => `${p.child_first_name} ${p.child_last_name}`).join(', '), to: '/preregistrations', action: t('dash.followUp'), level: 'high' as const }]
      : []),
    ...(openCases.length ? [{ key: 'cases', title: t('dash.openCases', { n: openCases.length }), detail: openCases[0].subject, to: '/cases', action: t('dash.answer'), level: 'critical' as const }] : []),
    ...(classRows.length === 0 ? [{ key: 'classes', title: t('dash.noClasses'), to: '/classes', action: t('dash.createClasses'), level: 'high' as const }] : []),
    ...(noTimetable.length && classRows.length
      ? [{ key: 'tt', title: t('dash.noTimetable', { n: noTimetable.length, total: classRows.length }), detail: noTimetable.slice(0, 3).map((c) => c.name).join(', '), to: '/timetable', action: t('common.continue'), level: 'low' as const }]
      : []),
    ...(unplaced.length ? [{ key: 'unplaced', title: t('dash.unplaced', { n: unplaced.length }), detail: unplaced.slice(0, 2).map((s) => fullName(s)).join(', '), to: '/students', action: t('dash.place'), level: 'high' as const }] : []),
    ...(noParent.length ? [{ key: 'parents', title: t('dash.noParent', { n: noParent.length }), to: '/students', action: t('dash.link'), level: 'low' as const }] : []),
    ...(overdue.length
      ? [
          {
            key: 'fees',
            title: t('dash.overdue', { n: overdue.length }),
            detail: `${formatMoney(overdue.reduce((s, b) => s + Number(b.amount_remaining), 0), locale)}${notReminded.length ? ` · ${t('dash.notReminded', { n: notReminded.length })}` : ''}`,
            to: '/fees',
            action: t('dash.seeFees'),
            level: 'high' as const,
          },
        ]
      : []),
  ]
  const enrolled = studentRows.filter((s) => currentEnrollment(s, ctx.year?.id)).length
  const absentCount = (absences.data ?? []).filter((a) => a.status === 'absent').length

  return (
    <>
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <StatCard value={enrolled} label={t('dash.enrolled')} />
        <StatCard value={classRows.length} label={t('nav.classes')} />
        <StatCard value={publishedCount} label={t('dash.publishedTimetables')} />
        <StatCard value={absentCount} label={t('dash.absentToday')} />
      </Stack>
      <SectionTitle
        aside={
          <Stack direction="row" spacing={0.5}>
            {(['critical', 'high', 'info', 'low'] as const).map((lv) => {
              const n = todos.filter((x) => x.level === lv).length
              return n ? <Tag key={lv} tone={LEVELS[lv].tone} label={n} /> : null
            })}
          </Stack>
        }
      >
        {t('dash.todo')}
      </SectionTitle>
      <TodoList items={todos} />
      <SectionTitle>{t('dash.absencesToday')}</SectionTitle>
      <Card>
        {(absences.data ?? []).length === 0 ? (
          <Typography color="text.secondary">{t('att.noneToday')}</Typography>
        ) : (
          <Stack spacing={1.25}>
            {(absences.data ?? []).map((a) => (
              <Stack key={a.id} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Avatar sx={{ width: 26, height: 26, fontSize: 10.5, bgcolor: subjectTokens(1).bg, color: subjectTokens(1).ink }}>{initials(fullName(a.student))}</Avatar>
                <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>
                  {fullName(a.student)} <span style={{ color: tokens.inkMuted }}>· {a.class?.name}</span>
                </Typography>
                <Tag tone={a.status === 'absent' ? 'danger' : a.status === 'late' ? 'warn' : 'info'} label={t(`att.status.${a.status}`)} />
                {(a.status === 'absent' || a.status === 'late') && (
                  <ParentNotified
                    recordId={a.id}
                    notifiedAt={a.parent_notified_at}
                    parents={guardiansToRecipients(studentRows.find((s) => s.id === a.student_id)?.guardians ?? [])}
                    child={fullName(a.student)}
                    date={a.session_date}
                    status={a.status}
                  />
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Card>
    </>
  )
}

function SessionList({ sessions, classNames }: { sessions: (DaySession | TeacherSession)[]; classNames?: Record<string, string> }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const names = useQuery(membersNamesQuery(ctx.school.id))
  const list = sessions.filter((s) => s.starts_at)
  if (!list.length) return <Typography color="text.secondary">{t('dash.noSessionToday')}</Typography>
  return (
    <Stack spacing={1}>
      {list.map((s, i) => {
        const c = subjectColor(s.subject_id)
        return (
          <Stack key={i} direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.25, borderRadius: 2, bgcolor: c.bg, opacity: s.status === 'cancelled' ? 0.55 : 1 }}>
            <Typography sx={{ fontWeight: 700, width: 52, color: c.ink }}>{hhmm(s.starts_at)}</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600, color: c.ink, textDecoration: s.status === 'cancelled' ? 'line-through' : 'none' }}>
                {subjects.data?.find((x) => x.id === s.subject_id)?.name ?? s.title ?? '—'}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: c.ink, opacity: 0.85 }}>
                {'class_id' in s && classNames ? classNames[s.class_id] : names.data?.[s.teacher_member_id ?? '']}
              </Typography>
            </Box>
            {s.status !== 'scheduled' && <Tag tone="warn" label={t(`tt.${s.status === 'changed' ? 'changed' : s.status === 'cancelled' ? 'cancelled' : 'added'}`)} />}
          </Stack>
        )
      })}
    </Stack>
  )
}

function TeacherDash() {
  const { t } = useI18n()
  const ctx = useSchool()
  const today = todayIso()
  const sessions = useQuery({
    queryKey: ['school', ctx.school.id, 'teacher-day', ctx.member.id, today],
    queryFn: async () => must(await supabase.rpc('teacher_day', { p_teacher_member_id: ctx.member.id, p_date: today })) as TeacherSession[],
  })
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const announcements = useQuery(announcementsQuery(ctx.school.id))
  const classNames = Object.fromEntries((classes.data ?? []).map((c) => [c.id, c.name]))
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
      <Card>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5 }}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            {t('dash.myDay')}
          </Typography>
          <Button component={Link} to="/attendance" size="small" variant="contained">
            {t('dash.rollCall')}
          </Button>
        </Stack>
        {sessions.isPending ? <Loading rows={3} /> : sessions.isError ? <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} /> : <SessionList sessions={sessions.data ?? []} classNames={classNames} />}
      </Card>
      <Stack spacing={2}>
        <Card>
          <Typography variant="h5" sx={{ mb: 1 }}>
            {t('dash.myClasses')}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {(classes.data ?? []).map((c) => (
              <Tag key={c.id} tone="info" label={`${c.name} · ${c.enrollments?.[0]?.count ?? 0}`} />
            ))}
            {(classes.data ?? []).length === 0 && <Typography color="text.secondary">{t('att.noTeacherClass')}</Typography>}
          </Stack>
        </Card>
        <LatestAnnouncements items={announcements.data ?? []} />
      </Stack>
    </Box>
  )
}

function LatestAnnouncements({ items }: { items: { id: string; title: string; body: string; status: string }[] }) {
  const { t } = useI18n()
  const shown = items.filter((a) => a.status === 'published').slice(0, 3)
  return (
    <Card>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t('dash.schoolMessages')}
        </Typography>
        <Button component={Link} to="/announcements" size="small">
          {t('dash.seeAll')}
        </Button>
      </Stack>
      {shown.length === 0 && <Typography color="text.secondary">{t('ann.empty')}</Typography>}
      <Stack spacing={1}>
        {shown.map((a) => (
          <Box key={a.id} sx={{ borderTop: `1px solid ${tokens.lineSoft}`, pt: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{a.title}</Typography>
            <Typography noWrap sx={{ fontSize: 13, color: tokens.inkSoft }}>
              {a.body}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Card>
  )
}

function ParentDash() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const kids = useQuery(studentsQuery(ctx.school.id))
  const balances = useQuery({ ...balancesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const announcements = useQuery(announcementsQuery(ctx.school.id))
  const cases = useQuery(casesQuery(ctx.school.id))
  const today = todayIso()
  const absencesToday = useQuery({
    queryKey: ['school', ctx.school.id, 'attendance', 'family-today', today],
    queryFn: async () => must(await supabase.from('attendance_records').select('student_id, status').eq('session_date', today).neq('status', 'present')),
  })
  const unjustified = useQuery({
    queryKey: ['school', ctx.school.id, 'attendance', 'family-unjustified'],
    queryFn: async () => must(await supabase.from('attendance_records').select('id, student_id').in('status', ['absent', 'late'])),
  })

  if (kids.isPending) return <Loading rows={4} />
  if (kids.isError) return <ErrorState error={kids.error} onRetry={() => kids.refetch()} />
  const due = (balances.data ?? []).filter((b) => ['overdue', 'partial', 'pending'].includes(b.payment_status))
  const next = due[0]
  const answered = (cases.data ?? []).filter((c) => c.status === 'answered')

  return (
    <>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {(kids.data ?? []).map((k) => {
          const absent = absencesToday.data?.find((a) => a.student_id === k.id)
          const toJustify = (unjustified.data ?? []).filter((a) => a.student_id === k.id).length
          return (
            <Paper key={k.id} variant="outlined" sx={{ p: 2, flex: '1 1 280px', borderColor: absent ? tokens.warnLine : tokens.lineSoft }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Avatar sx={{ bgcolor: subjectTokens(0).bg, color: subjectTokens(0).ink }}>{initials(fullName(k))}</Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontWeight: 600 }}>{k.first_name}</Typography>
                  <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{currentEnrollment(k, ctx.year?.id)?.class?.name ?? '—'}</Typography>
                </Box>
                {absent ? <Tag tone="warn" label={t(`att.status.${absent.status}`)} /> : <Tag tone="ok" label={t('dash.noAbsenceToday')} />}
              </Stack>
              {toJustify > 0 && (
                <Button component={Link} to="/attendance" size="small" sx={{ mt: 1 }}>
                  {t('dash.toJustify', { n: toJustify })}
                </Button>
              )}
            </Paper>
          )
        })}
        {(kids.data ?? []).length === 0 && <Typography color="text.secondary">{t('dash.noKids')}</Typography>}
      </Stack>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mt: 2 }}>
        <Card>
          <Typography variant="h5" sx={{ mb: 1 }}>
            {t('nav.fees')}
          </Typography>
          {next ? (
            <>
              <Typography sx={{ fontFamily: tokens.display, fontSize: 26 }}>{formatMoney(next.amount_remaining, locale)}</Typography>
              <Typography sx={{ fontSize: 13.5, color: tokens.inkSoft }}>
                {next.label} · {formatDate(next.due_on, locale)}
              </Typography>
              {next.payment_status === 'overdue' && <Tag tone="danger" label={t('fees.status.overdue')} sx={{ mt: 1 }} />}
            </>
          ) : (
            <Typography color="text.secondary">{t('dash.feesUpToDate')}</Typography>
          )}
          <Button component={Link} to="/fees" size="small" sx={{ mt: 1 }}>
            {t('dash.seeAll')}
          </Button>
        </Card>
        <LatestAnnouncements items={announcements.data ?? []} />
      </Box>
      {answered.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2, bgcolor: tokens.accentSoft, borderColor: tokens.accentLine }}>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Typography sx={{ flex: 1, color: tokens.accentDark, fontWeight: 600 }}>{t('dash.schoolReplied', { n: answered.length })}</Typography>
            <Button component={Link} to="/cases" size="small" variant="contained">
              {t('dash.read')}
            </Button>
          </Stack>
        </Paper>
      )}
    </>
  )
}

function StudentDash() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const me = useQuery(studentsQuery(ctx.school.id))
  const homework = useQuery(homeworkQuery(ctx.school.id))
  const self = me.data?.[0]
  const classId = self ? currentEnrollment(self, ctx.year?.id)?.class_id : undefined
  const today = todayIso()
  const day = useQuery({
    queryKey: ['school', ctx.school.id, 'tt-day', classId, today],
    enabled: !!classId,
    queryFn: async () => must(await supabase.rpc('timetable_day', { p_class_id: classId!, p_date: today })) as DaySession[],
  })
  const absences = useQuery({
    queryKey: ['school', ctx.school.id, 'attendance', 'self-count'],
    queryFn: async () => must(await supabase.from('attendance_records').select('id, status').neq('status', 'present')),
  })
  const upcoming = (homework.data ?? []).filter((h) => !h.due_on || h.due_on >= today).slice(0, 4)

  if (me.isPending) return <Loading rows={4} />
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' } }}>
      <Card>
        <Typography variant="h5" sx={{ mb: 1.5 }}>
          {t('dash.myDay')} {self ? `· ${currentEnrollment(self, ctx.year?.id)?.class?.name ?? ''}` : ''}
        </Typography>
        {day.isPending && classId ? <Loading rows={3} /> : <SessionList sessions={day.data ?? []} />}
      </Card>
      <Stack spacing={2}>
        <Card>
          <Typography variant="h5" sx={{ mb: 1 }}>
            {t('dash.homeworkDue')}
          </Typography>
          {upcoming.length === 0 && <Typography color="text.secondary">{t('hw.empty')}</Typography>}
          <Stack spacing={1}>
            {upcoming.map((h) => (
              <Box key={h.id} sx={{ borderTop: `1px solid ${tokens.lineSoft}`, pt: 1 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{h.title}</Typography>
                <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{h.due_on ? t('hw.due', { date: formatDate(h.due_on, locale) }) : ''}</Typography>
              </Box>
            ))}
          </Stack>
        </Card>
        <Card>
          <Typography variant="h5" sx={{ mb: 0.5 }}>
            {t('nav.attendance')}
          </Typography>
          <Typography sx={{ fontSize: 14, color: tokens.inkSoft }}>
            {t('dash.myAbsences', {
              absent: (absences.data ?? []).filter((a) => a.status === 'absent').length,
              late: (absences.data ?? []).filter((a) => a.status === 'late').length,
            })}
          </Typography>
          <Button component={Link} to="/attendance" size="small" sx={{ mt: 1 }}>
            {t('dash.seeAll')}
          </Button>
        </Card>
      </Stack>
    </Box>
  )
}
