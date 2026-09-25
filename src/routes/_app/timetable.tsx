import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { AppShell } from '#/components/AppShell'
import { PageIntro, fullName } from '#/components/ui'
import { EmptyState, ErrorState, Loading } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { addDays, formatDate, mondayOf, todayIso } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
import { subjectsQuery } from '#/features/structure/api'
import { Builder } from '#/features/timetable/Builder'
import { RealWeek, WeekNav, useSchoolDays } from '#/features/timetable/RealWeek'
import { WeekGrid, type Block } from '#/features/timetable/WeekGrid'
import { subjectColor, teacherWeekQuery } from '#/features/timetable/api'
import { tokens } from '#/theme/theme'
import { membersQuery } from '#/features/team/api'

export const Route = createFileRoute('/_app/timetable')({
  validateSearch: (s: Record<string, unknown>): { classId?: string; mode?: 'week' | 'edit' | 'teacher'; teacherId?: string } => ({
    classId: typeof s.classId === 'string' ? s.classId : undefined,
    mode: s.mode === 'edit' || s.mode === 'week' || s.mode === 'teacher' ? s.mode : undefined,
    teacherId: typeof s.teacherId === 'string' ? s.teacherId : undefined,
  }),
  component: TimetablePage,
})

function TimetablePage() {
  const { t } = useI18n()
  const ctx = useSchool()
  return (
    <AppShell title={t('nav.timetable')}>
      {ctx.isOffice ? <OfficeView /> : ctx.role === 'teacher' ? <TeacherView memberId={ctx.member.id} /> : <FamilyView />}
    </AppShell>
  )
}

function OfficeView() {
  const { t } = useI18n()
  const ctx = useSchool()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const classId = search.classId ?? classes.data?.[0]?.id
  const mode = search.mode ?? (ctx.isAdmin ? 'edit' : 'week')

  if (!ctx.year) return <EmptyState title={t('year.none')} hint={t('year.noneHint')} />
  if (classes.isPending) return <Loading rows={5} />
  if (classes.isError) return <ErrorState error={classes.error} onRetry={() => classes.refetch()} />
  if (!classes.data?.length) return <EmptyState title={t('tt.noClasses')} hint={t('tt.noClassesHint')} />

  const tabs = (
    <Tabs value={mode} onChange={(_, v) => navigate({ search: (s) => ({ ...s, mode: v }) })} sx={{ mb: 2, borderBottom: `1px solid ${tokens.line}` }}>
      <Tab value="week" label={t('tt.tab.week')} />
      {ctx.isAdmin && <Tab value="edit" label={t('tt.tab.edit')} />}
      <Tab value="teacher" label={t('tt.tab.teacher')} />
    </Tabs>
  )
  if (mode === 'teacher') return <OfficeTeacherView tabs={tabs} />

  return (
    <>
      <PageIntro
        title={t('tt.title')}
        subtitle={t('tt.subtitle')}
        actions={
          <TextField
            select
            label={t('tt.chooseClass')}
            value={classId ?? ''}
            onChange={(e) => navigate({ search: (s) => ({ ...s, classId: e.target.value }) })}
            sx={{ minWidth: 240 }}
          >
            {classes.data.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      {tabs}
      {classId && (mode === 'edit' && ctx.isAdmin ? <Builder classId={classId} /> : <RealWeek key={classId} classId={classId} allowExceptions />)}
    </>
  )
}

// Parent: one of their children; student: themselves. Read-only real week.
function FamilyView() {
  const { t } = useI18n()
  const ctx = useSchool()
  const students = useQuery(studentsQuery(ctx.school.id))
  const [studentId, setStudentId] = useState<string | null>(null)
  const kids = (students.data ?? []).filter((s) => currentEnrollment(s, ctx.year?.id))
  const current = kids.find((k) => k.id === studentId) ?? kids[0]
  const classId = current ? currentEnrollment(current, ctx.year?.id)?.class_id : undefined

  if (students.isPending) return <Loading rows={5} />
  if (students.isError) return <ErrorState error={students.error} onRetry={() => students.refetch()} />
  if (!current || !classId) return <EmptyState title={t('tt.noChildClass')} />
  return (
    <>
      <PageIntro
        title={t('tt.titleFor', { name: current.first_name })}
        subtitle={currentEnrollment(current, ctx.year?.id)?.class?.name}
        actions={
          kids.length > 1 && (
            <TextField select label={t('tt.child')} value={current.id} onChange={(e) => setStudentId(e.target.value)} sx={{ minWidth: 200 }}>
              {kids.map((k) => (
                <MenuItem key={k.id} value={k.id}>
                  {fullName(k)}
                </MenuItem>
              ))}
            </TextField>
          )
        }
      />
      <RealWeek key={classId} classId={classId} allowExceptions={false} />
    </>
  )
}

// Office: any teacher's week (who teaches when, across classes)
function OfficeTeacherView({ tabs }: { tabs: React.ReactNode }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const members = useQuery(membersQuery(ctx.school.id))
  const teachers = (members.data ?? [])
    .filter((m) => m.role === 'teacher' && m.status === 'active')
    .sort((a, b) => (a.user?.full_name ?? '').localeCompare(b.user?.full_name ?? ''))
  const teacherId = search.teacherId ?? teachers[0]?.id
  const teacher = teachers.find((m) => m.id === teacherId)
  return (
    <>
      <PageIntro
        title={t('tt.title')}
        subtitle={t('tt.teacherWeekHint')}
        actions={
          <TextField
            select
            label={t('tt.chooseTeacher')}
            value={teacherId ?? ''}
            onChange={(e) => navigate({ search: (s) => ({ ...s, teacherId: e.target.value }) })}
            sx={{ minWidth: 240 }}
          >
            {teachers.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.user?.full_name}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      {tabs}
      {members.isPending ? (
        <Loading rows={4} />
      ) : teacher ? (
        <TeacherView key={teacher.id} memberId={teacher.id} embedded />
      ) : (
        <EmptyState title={t('presence.noTeachers')} />
      )}
    </>
  )
}

// Teacher: every session across their classes, substitutions included.
function TeacherView({ memberId, embedded }: { memberId: string; embedded?: boolean }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const { days, start, end } = useSchoolDays()
  const [monday, setMonday] = useState(mondayOf(ctx.year && todayIso() < ctx.year.starts_on ? ctx.year.starts_on : todayIso()))
  const week = useQuery(teacherWeekQuery(ctx.school.id, memberId, monday, days))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const dayNames = t('setup.dayNames').split(',')
  const labels = Object.fromEntries(
    days.map((d) => [d, `${dayNames[d - 1]} ${formatDate(addDays(monday, d - 1), locale, { day: 'numeric', month: 'short' })}`]),
  )
  const blocks: Block[] = days.flatMap((d) =>
    (week.data?.[d] ?? []).map((s) => ({
      key: `${d}-${s.slot_id ?? s.exception_id}`,
      weekday: d,
      start: s.starts_at!,
      end: s.ends_at!,
      title: subjects.data?.find((x) => x.id === s.subject_id)?.name ?? s.title ?? '—',
      lines: [classes.data?.find((c) => c.id === s.class_id)?.name ?? ''],
      color: subjectColor(s.subject_id),
      badge: s.status === 'changed' ? t('tt.changed') : s.status === 'added' ? t('tt.added') : undefined,
    })),
  )
  return (
    <>
      {!embedded && <PageIntro title={t('tt.myWeek')} subtitle={t('tt.myWeekHint')} />}
      <Stack spacing={2}>
        <WeekNav monday={monday} onChange={setMonday} />
        {week.isPending ? (
          <Loading rows={4} />
        ) : week.isError ? (
          <ErrorState error={week.error} onRetry={() => week.refetch()} />
        ) : (
          <WeekGrid days={days} dayLabels={labels} blocks={blocks} dayStart={start} dayEnd={end} emptyText={t('tt.noSessions')} />
        )}
        {!embedded && (
          <Typography variant="body2" color="text.secondary">
            {t('tt.teacherNote')}
          </Typography>
        )}
      </Stack>
    </>
  )
}
