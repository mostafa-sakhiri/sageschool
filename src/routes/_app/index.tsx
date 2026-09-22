import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Avatar, Box, Button, Paper, Stack, Typography } from '@mui/material'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import { AppShell } from '#/components/AppShell'
import { Card, PageIntro, SectionTitle, StatCard, Tag, fullName, initials } from '#/components/ui'
import { ErrorState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { formatDate, formatMoney, hhmm, todayIso } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
import { subjectsQuery } from '#/features/structure/api'
import { membersNamesQuery, subjectColor, type DaySession, type TeacherSession } from '#/features/timetable/api'
import { announcementsQuery, balancesQuery, casesQuery, homeworkQuery } from '#/features/queries'
import { tokens } from '#/theme/theme'

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
      {ctx.isOffice ? <OfficeDash /> : ctx.role === 'teacher' ? <TeacherDash /> : ctx.role === 'parent' ? <ParentDash /> : <StudentDash />}
    </AppShell>
  )
}

type Todo = { key: string; title: string; detail?: string; to: string; action: string; urgent?: boolean }

function TodoList({ items }: { items: Todo[] }) {
  const { t } = useI18n()
  if (!items.length)
    return (
      <Paper variant="outlined" sx={{ p: 2.5, bgcolor: tokens.accentSoft, borderColor: tokens.accentLine, display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <CheckOutlined sx={{ color: tokens.accentDark }} />
        <Typography sx={{ color: tokens.accentDark }}>{t('dash.nothing')}</Typography>
      </Paper>
    )
  return (
    <Stack spacing={1}>
      {items.map((a) => (
        <Paper
          key={a.key}
          variant="outlined"
          sx={{
            p: 2,
            display: 'flex',
            gap: 1.75,
            alignItems: 'center',
            flexWrap: { xs: 'wrap', sm: 'nowrap' },
            bgcolor: a.urgent ? tokens.cardWarm : '#fff',
            borderColor: a.urgent ? tokens.warnLine : tokens.lineSoft,
          }}
        >
          <Box sx={{ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: a.urgent ? tokens.warnSoft : '#F2EEE4', color: a.urgent ? '#9A5B12' : tokens.inkMuted, flexShrink: 0 }}>
            <WarningAmberOutlined fontSize="small" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{a.title}</Typography>
            {a.detail && <Typography sx={{ fontSize: 13, color: tokens.inkSoft }}>{a.detail}</Typography>}
          </Box>
          <Button component={Link} to={a.to} variant={a.urgent ? 'contained' : 'outlined'} size="small">
            {a.action}
          </Button>
        </Paper>
      ))}
    </Stack>
  )
}

function OfficeDash() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const students = useQuery(studentsQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const cases = useQuery(casesQuery(ctx.school.id))
  const balances = useQuery({ ...balancesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const published = useQuery({
    queryKey: ['school', ctx.school.id, 'published-classes'],
    queryFn: async () =>
      new Set(must(await supabase.from('timetable_versions').select('class_id').eq('school_id', ctx.school.id).eq('status', 'published')).map((v) => v.class_id)),
  })
  const today = todayIso()
  const absences = useQuery({
    queryKey: ['school', ctx.school.id, 'absences-day', today],
    queryFn: async () =>
      must(
        await supabase
          .from('attendance_records')
          .select('id, status, justification, student:students(first_name, last_name), class:classes(name)')
          .eq('school_id', ctx.school.id)
          .eq('session_date', today)
          .neq('status', 'present'),
      ) as unknown as { id: string; status: string; student: { first_name: string; last_name: string }; class: { name: string } }[],
  })

  if (!ctx.year)
    return (
      <TodoList items={[{ key: 'year', title: t('year.none'), detail: t('year.noneHint'), to: '/setup', action: t('dash.createYear'), urgent: true }]} />
    )
  if (students.isPending || classes.isPending) return <Loading rows={5} />
  if (students.isError || classes.isError) return <ErrorState error={students.error ?? classes.error} onRetry={() => (students.refetch(), classes.refetch())} />

  const studentRows = students.data ?? []
  const classRows = classes.data ?? []
  const unplaced = studentRows.filter((s) => s.status === 'active' && !currentEnrollment(s, ctx.year?.id))
  const noTimetable = classRows.filter((c) => !published.data?.has(c.id))
  // Only this year's classes count (the query covers every year of the school).
  const publishedCount = classRows.filter((c) => published.data?.has(c.id)).length
  const openCases = (cases.data ?? []).filter((c) => c.status === 'open')
  const overdue = (balances.data ?? []).filter((b) => b.payment_status === 'overdue')
  const noParent = studentRows.filter((s) => s.guardians.length === 0)

  const todos: Todo[] = [
    ...(openCases.length ? [{ key: 'cases', title: t('dash.openCases', { n: openCases.length }), detail: openCases[0].subject, to: '/cases', action: t('dash.answer'), urgent: true }] : []),
    ...(classRows.length === 0 ? [{ key: 'classes', title: t('dash.noClasses'), to: '/classes', action: t('dash.createClasses'), urgent: true }] : []),
    ...(noTimetable.length && classRows.length
      ? [{ key: 'tt', title: t('dash.noTimetable', { n: noTimetable.length, total: classRows.length }), detail: noTimetable.slice(0, 3).map((c) => c.name).join(', '), to: '/timetable', action: t('common.continue') }]
      : []),
    ...(unplaced.length ? [{ key: 'unplaced', title: t('dash.unplaced', { n: unplaced.length }), detail: unplaced.slice(0, 2).map((s) => fullName(s)).join(', '), to: '/students', action: t('dash.place') }] : []),
    ...(noParent.length ? [{ key: 'parents', title: t('dash.noParent', { n: noParent.length }), to: '/students', action: t('dash.link') }] : []),
    ...(overdue.length
      ? [{ key: 'fees', title: t('dash.overdue', { n: overdue.length }), detail: formatMoney(overdue.reduce((s, b) => s + Number(b.amount_remaining), 0), locale), to: '/fees', action: t('dash.seeFees') }]
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
      <SectionTitle aside={<Tag tone="warn" label={todos.length} />}>{t('dash.todo')}</SectionTitle>
      <TodoList items={todos} />
      <SectionTitle>{t('dash.absencesToday')}</SectionTitle>
      <Card>
        {(absences.data ?? []).length === 0 ? (
          <Typography color="text.secondary">{t('att.noneToday')}</Typography>
        ) : (
          <Stack spacing={1.25}>
            {(absences.data ?? []).map((a) => (
              <Stack key={a.id} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Avatar sx={{ width: 26, height: 26, fontSize: 10.5, bgcolor: '#F7E9E2', color: '#7A4423' }}>{initials(fullName(a.student))}</Avatar>
                <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>
                  {fullName(a.student)} <span style={{ color: tokens.inkMuted }}>· {a.class?.name}</span>
                </Typography>
                <Tag tone={a.status === 'absent' ? 'danger' : a.status === 'late' ? 'warn' : 'info'} label={t(`att.status.${a.status}`)} />
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
                <Avatar sx={{ bgcolor: '#E7EEF7', color: '#2A4A6B', fontWeight: 700 }}>{initials(fullName(k))}</Avatar>
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
