import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Link as MuiLink, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import CakeOutlined from '@mui/icons-material/CakeOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, StatCard, Tag, fullName } from '#/components/ui'
import { EmptyState, ErrorState, Loading, NotFound } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { addDays, formatDate, formatPhone, todayIso } from '#/lib/format'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
import { BIRTHDAY_STATUSES, birthdayPlansQuery, birthdaysBetween, twoWeeks, type Birthday, type BirthdayStatus } from '#/features/birthdays/api'
import { tokens } from '#/theme/theme'

export const Route = createFileRoute('/_app/events')({ component: EventsPage })

type Range = 'twoWeeks' | 'month' | 'year' | 'past'

function EventsPage() {
  const { t } = useI18n()
  const ctx = useSchool()
  const students = useQuery(studentsQuery(ctx.school.id))
  const plans = useQuery({ ...birthdayPlansQuery(ctx.school.id), enabled: ctx.can('events.birthdays') })
  const [range, setRange] = useState<Range>('twoWeeks')
  const today = todayIso()
  const [from, to] =
    range === 'twoWeeks' ? twoWeeks(today) : range === 'month' ? [today, addDays(today, 30)] : range === 'year' ? [today, addDays(today, 364)] : [addDays(today, -30), addDays(today, -1)]

  if (!ctx.can('events.birthdays'))
    return (
      <AppShell title={t('nav.events')}>
        <NotFound />
      </AppShell>
    )

  const list = birthdaysBetween(students.data ?? [], from, to, plans.data ?? {})
  const shown = range === 'past' ? [...list].reverse() : list
  const week = birthdaysBetween(students.data ?? [], ...twoWeeks(today), plans.data ?? {})
  return (
    <AppShell title={t('nav.events')}>
      <PageIntro title={t('events.title')} subtitle={t('events.subtitle')} />
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', mb: 2.5 }}>
        <StatCard value={week.length} label={t('events.thisWeek')} />
        <StatCard value={week.filter((b) => b.status === 'to_organize').length} label={t('events.toOrganizeCount')} />
        <StatCard value={week.filter((b) => b.status === 'organized').length} label={t('events.organizedCount')} />
      </Stack>
      <ToggleButtonGroup exclusive size="small" value={range} onChange={(_, v) => v && setRange(v)} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <ToggleButton value="twoWeeks">{t('events.range.twoWeeks')}</ToggleButton>
        <ToggleButton value="month">{t('events.range.month')}</ToggleButton>
        <ToggleButton value="year">{t('events.range.year')}</ToggleButton>
        <ToggleButton value="past">{t('events.range.past')}</ToggleButton>
      </ToggleButtonGroup>
      {students.isPending || plans.isPending ? (
        <Loading rows={4} />
      ) : students.isError || plans.isError ? (
        <ErrorState error={students.error ?? plans.error} onRetry={() => (students.refetch(), plans.refetch())} />
      ) : shown.length === 0 ? (
        <EmptyState title={t('events.none')} hint={t('events.noneHint')} />
      ) : (
        <Stack spacing={1}>
          {shown.map((b) => (
            <BirthdayRow key={`${b.student.id}:${b.year}`} b={b} today={today} />
          ))}
        </Stack>
      )}
    </AppShell>
  )
}

function BirthdayRow({ b, today }: { b: Birthday; today: string }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: async (status: BirthdayStatus) =>
      must(
        await supabase
          .from('birthday_plans')
          .upsert({ school_id: ctx.school.id, student_id: b.student.id, year: b.year, status }, { onConflict: 'student_id,year' }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'birthday-plans'] }),
  })
  const status = save.isPending ? save.variables : b.status
  const days = Math.round((new Date(`${b.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000)
  const when = days === 0 ? t('events.today') : days === 1 ? t('events.tomorrow') : days > 0 ? t('events.inDays', { n: days }) : t('events.daysAgo', { n: -days })
  const klass = currentEnrollment(b.student, ctx.year?.id)?.class?.name
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        display: 'flex',
        gap: 2,
        alignItems: { md: 'center' },
        flexDirection: { xs: 'column', md: 'row' },
        borderInlineStart: `3px solid ${days === 0 ? tokens.accentDark : tokens.line}`,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: { md: 240 } }}>
        <Box sx={{ width: 40, height: 40, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: tokens.accentSoft, color: tokens.accentDark, flexShrink: 0 }}>
          <CakeOutlined fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{fullName(b.student)}</Typography>
          <Typography sx={{ fontSize: 13, color: tokens.inkSoft }}>
            {t('events.turns', { n: b.age })}
            {klass ? ` · ${klass}` : ''}
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ minWidth: { md: 150 } }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{formatDate(b.date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</Typography>
        <Typography sx={{ fontSize: 13, color: days === 0 ? tokens.accentDark : tokens.inkMuted }}>{when}</Typography>
      </Box>
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        {b.student.guardians.length === 0 && <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('events.noParent')}</Typography>}
        {b.student.guardians.map((g) => (
          <Typography key={g.guardian_member_id} sx={{ fontSize: 13.5 }}>
            {g.member?.user?.full_name ?? '—'}
            {g.relationship && <span style={{ color: tokens.inkMuted }}> ({t(`students.rel.${g.relationship}`)})</span>}
            {' · '}
            {g.member?.user?.phone ? (
              <MuiLink href={`tel:${g.member.user.phone}`} sx={{ whiteSpace: 'nowrap' }}>
                {formatPhone(g.member.user.phone)}
              </MuiLink>
            ) : (
              <span style={{ color: tokens.inkMuted }}>{t('events.noPhone')}</span>
            )}
          </Typography>
        ))}
      </Stack>
      <Stack spacing={0.5} sx={{ alignItems: { md: 'flex-end' } }}>
        {!ctx.can('events.manage') ? (
          <Tag tone={status === 'organized' ? 'ok' : status === 'to_organize' ? 'warn' : 'neutral'} label={t(`events.st.${status}`)} />
        ) : (
        <ToggleButtonGroup
          exclusive
          size="small"
          value={status}
          onChange={(_, v: BirthdayStatus | null) => v && v !== status && save.mutate(v)}
          aria-label={t('events.status')}
        >
          {BIRTHDAY_STATUSES.map((s) => (
            <ToggleButton key={s} value={s} sx={{ whiteSpace: 'nowrap' }}>
              {t(`events.st.${s}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        )}
        {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
      </Stack>
    </Paper>
  )
}
