import { useContext } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Box, Paper, Stack, Step, StepLabel, Stepper, Tab, Tabs, Typography } from '@mui/material'
import { OnboardingShell } from '#/components/OnboardingShell'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Card, Tag } from '#/components/ui'
import { EmptyState, Loading } from '#/components/states'
import { SchoolContext } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { CreateSchool, Footer, teachableMinutes, type Opening } from '#/features/setup/CreateSchool'
import { YearForm, YearSection } from '#/features/setup/YearSection'
import { HoursSection } from '#/features/setup/HoursSection'
import { RoomsSection } from '#/features/setup/RoomsSection'
import { formatMinutes, nodeName, nodesQuery } from '#/features/structure/api'
import { tokens } from '#/theme/theme'

type Search = { step?: number; tab?: string }

export const Route = createFileRoute('/_app/setup')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    step: s.step ? Number(s.step) : undefined,
    tab: typeof s.tab === 'string' ? s.tab : undefined,
  }),
  component: SetupPage,
})

const STEPS = ['setup.steps.school', 'setup.steps.levels', 'setup.steps.year', 'setup.steps.subjects', 'setup.steps.rooms']

function SetupPage() {
  const ctx = useContext(SchoolContext)
  const { step } = Route.useSearch()
  // No school yet: steps 1-2 create it. With a school: ?step=3..5 continues the
  // wizard, otherwise this is the settings page.
  if (!ctx) return <Wizard step={step === 2 ? 2 : 1} />
  if (step && step >= 3) return <Wizard step={step} />
  return <Settings />
}

function Wizard({ step }: { step: number }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const go = (s: number) => navigate({ to: '/setup', search: { step: s } })
  return (
    <OnboardingShell wide>
      <Typography variant="overline" sx={{ color: tokens.accent }}>
        {t('setup.install')}
      </Typography>
      <Stepper activeStep={step - 1} alternativeLabel sx={{ my: 3 }}>
        {STEPS.map((k) => (
          <Step key={k}>
            <StepLabel>{t(k)}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {step <= 2 ? <CreateSchool step={step as 1 | 2} onStep={go} /> : <ContinueWizard step={step} go={go} />}
    </OnboardingShell>
  )
}

function ContinueWizard({ step, go }: { step: number; go: (s: number) => void }) {
  const { t } = useI18n()
  const ctx = useContext(SchoolContext)!
  const navigate = useNavigate()

  if (step === 3) {
    return (
      <Stack spacing={2.5}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h3">{t('setup.yearTitle')}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
            {t('setup.yearHint')}
          </Typography>
          {ctx.year ? (
            <Typography>{t('setup.yearExists', { name: ctx.year.name })}</Typography>
          ) : (
            <YearForm schoolId={ctx.school.id} onDone={() => go(4)} submitLabel={t('setup.createYear')} />
          )}
        </Paper>
        {ctx.year && <Footer onNext={() => go(4)} nextLabel={t('common.continue')} />}
      </Stack>
    )
  }
  if (step === 4) {
    return (
      <Stack spacing={2.5}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h3">{t('setup.subjectsTitle')}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
            {t('setup.subjectsHint')}
          </Typography>
          {ctx.year ? <HoursSection schoolId={ctx.school.id} yearId={ctx.year.id} /> : <Loading />}
        </Paper>
        <Footer onBack={() => go(3)} onNext={() => go(5)} nextLabel={t('common.continue')} />
      </Stack>
    )
  }
  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h3">{t('setup.roomsTitle')}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
          {t('setup.roomsHint')}
        </Typography>
        <RoomsSection schoolId={ctx.school.id} />
      </Paper>
      <Footer
        left={t('setup.finishHint')}
        onBack={() => go(4)}
        onNext={() => navigate({ to: '/' })}
        nextLabel={t('setup.finish')}
      />
    </Stack>
  )
}

const TABS = ['school', 'structure', 'years', 'hours', 'rooms'] as const

function Settings() {
  const { t } = useI18n()
  const ctx = useContext(SchoolContext)!
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const current = (TABS as readonly string[]).includes(tab ?? '') ? tab! : 'school'

  return (
    <AppShell title={t('nav.settings')}>
      <PageIntro title={ctx.school.name} subtitle={t('settings.subtitle')} />
      <Tabs
        value={current}
        onChange={(_, v) => navigate({ to: '/setup', search: { tab: v } })}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2.5, borderBottom: `1px solid ${tokens.line}` }}
      >
        {TABS.map((k) => (
          <Tab key={k} value={k} label={t(`settings.tab.${k}`)} />
        ))}
      </Tabs>
      {current === 'school' && <SchoolInfo />}
      {current === 'structure' && <TreeSection schoolId={ctx.school.id} />}
      {current === 'years' && <YearSection schoolId={ctx.school.id} />}
      {current === 'hours' &&
        (ctx.year ? (
          <HoursSection schoolId={ctx.school.id} yearId={ctx.year.id} />
        ) : (
          <EmptyState title={t('year.none')} hint={t('year.noneHint')} />
        ))}
      {current === 'rooms' && <RoomsSection schoolId={ctx.school.id} />}
    </AppShell>
  )
}

function SchoolInfo() {
  const { t } = useI18n()
  const ctx = useContext(SchoolContext)!
  const s = ctx.school.settings as { city?: string; address?: string; opening?: Opening; levels_offered?: string[] }
  const o = s.opening
  const dayNames = t('setup.dayNames').split(',')
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      <Card>
        <Typography variant="h5" sx={{ mb: 1.5 }}>
          {t('setup.schoolTitle')}
        </Typography>
        <Info label={t('setup.schoolName')} value={ctx.school.name} />
        <Info label={t('setup.city')} value={s.city || '—'} />
        <Info label={t('setup.address')} value={s.address || '—'} />
      </Card>
      {o && (
        <Card>
          <Typography variant="h5" sx={{ mb: 1.5 }}>
            {t('setup.hoursTitle')}
          </Typography>
          <Info label={t('setup.days')} value={o.days.map((d) => dayNames[Number(d) - 1]).join(', ')} />
          <Info label={t('setup.period.day')} value={`${o.day[0]} → ${o.day[1]}`} />
          <Info label={t('setup.period.lunch')} value={`${o.lunch[0]} → ${o.lunch[1]}`} />
          <Info label={t('setup.period.recess')} value={`${o.recess[0]} → ${o.recess[1]}`} />
          <Info label={t('settings.teachablePerWeek')} value={formatMinutes(teachableMinutes(o) * o.days.length)} />
        </Card>
      )}
    </Box>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.75, borderBottom: `1px solid ${tokens.lineSoft}` }}>
      <Typography sx={{ width: 180, color: tokens.inkMuted, fontSize: 13.5 }}>{label}</Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{value}</Typography>
    </Stack>
  )
}

function TreeSection({ schoolId }: { schoolId: string }) {
  const { t, locale } = useI18n()
  const nodes = useQuery(nodesQuery(schoolId))
  if (nodes.isPending) return <Loading rows={6} />
  const all = nodes.data ?? []
  return (
    <Card>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('settings.treeHint')}
      </Typography>
      {all.map((n) => (
        <Stack
          key={n.id}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', py: 0.5, pl: (n.path.length - 1) * 3 }}
        >
          <Typography sx={{ fontWeight: n.kind === 'cycle' ? 700 : 500, fontSize: n.kind === 'cycle' ? 15 : 14 }}>
            {nodeName(n, locale)}
          </Typography>
          <Tag label={t(`node.${n.kind}`)} />
        </Stack>
      ))}
    </Card>
  )
}
