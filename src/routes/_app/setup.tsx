import { useContext, useEffect, useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, Stack, Step, StepLabel, Stepper, TextField, Typography } from '@mui/material'
import { OnboardingShell } from '#/components/OnboardingShell'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Card } from '#/components/ui'
import { EmptyState, Loading } from '#/components/states'
import { SchoolContext } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { CreateSchool, StepActions } from '#/features/setup/CreateSchool'
import { ScheduleEditor } from '#/features/setup/ScheduleEditor'
import { presetHoraire, readHoraires, weeklyTeachable, type Horaire } from '#/features/setup/schedule'
import { supabase } from '#/lib/supabase/client'
import type { Json } from '#/lib/database.types'
import { errorMessage, must } from '#/lib/errors'
import { YearForm, YearSection } from '#/features/setup/YearSection'
import { HoursSection } from '#/features/setup/HoursSection'
import { RoomsSection } from '#/features/setup/RoomsSection'
import { RolesSection } from '#/features/setup/AccessSection'
import { StructureSection } from '#/features/setup/StructureSection'
import { ImportPanel } from '#/features/import/ImportZone'
import { nodeName, nodesQuery } from '#/features/structure/api'
import { tokens } from '#/theme/theme'

type Search = { step?: number; tab?: string; new?: boolean; role?: string }

export const Route = createFileRoute('/_app/setup')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    step: s.step ? Number(s.step) : undefined,
    tab: typeof s.tab === 'string' ? s.tab : undefined,
    // Réglages › Rôles: the role opened
    role: typeof s.role === 'string' ? s.role : undefined,
    // ?new=1: create another school while already a member of one
    new: s.new === true || s.new === 1 || s.new === '1' || undefined,
  }),
  component: SetupPage,
})

const STEPS = ['setup.steps.school', 'setup.steps.levels', 'setup.steps.year', 'setup.steps.subjects', 'setup.steps.rooms', 'setup.steps.data']

function SetupPage() {
  const ctx = useContext(SchoolContext)
  const { step, new: isNew } = Route.useSearch()
  // No school yet (or ?new=1): steps 1-2 create it. With a school: ?step=3..5
  // continues the wizard, otherwise this is the settings page.
  if (!ctx || (isNew && (!step || step <= 2))) return <Wizard step={step === 2 ? 2 : 1} />
  if (step && step >= 3) return <Wizard step={step} />
  return <Settings />
}

function Wizard({ step }: { step: number }) {
  const { t } = useI18n()
  const ctx = useContext(SchoolContext)
  const { new: isNew } = Route.useSearch()
  const navigate = useNavigate()
  const go = (s: number) => navigate({ to: '/setup', search: { step: s, new: s <= 2 ? isNew : undefined } })
  return (
    <OnboardingShell wide>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="overline" sx={{ color: tokens.accent, flex: 1 }}>
          {isNew ? t('setup.installAnother') : t('setup.install')}
        </Typography>
        {ctx && isNew && (
          <Button onClick={() => navigate({ to: '/' })}>{t('setup.backTo', { name: ctx.school.name })}</Button>
        )}
      </Stack>
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
        {ctx.year && <StepActions onNext={() => go(4)} nextLabel={t('common.continue')} />}
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
      </Stack>
    )
  }
  if (step === 4) {
    return (
      <Stack spacing={2.5}>
        <StepActions onBack={() => go(3)} onNext={() => go(5)} nextLabel={t('common.continue')} />
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h3">{t('setup.subjectsTitle')}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
            {t('setup.subjectsHint')}
          </Typography>
          {ctx.year ? <HoursSection schoolId={ctx.school.id} yearId={ctx.year.id} /> : <Loading />}
        </Paper>
      </Stack>
    )
  }
  if (step === 6) {
    return (
      <Stack spacing={2.5}>
        <StepActions
          left={t('setup.finishHint')}
          onBack={() => go(5)}
          onNext={() => navigate({ to: '/' })}
          nextLabel={t('setup.finish')}
        />
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h3">{t('setup.dataTitle')}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
            {t('setup.dataHint')}
          </Typography>
          <ImportPanel kinds={['teachers', 'administration', 'students']} />
        </Paper>
      </Stack>
    )
  }
  return (
    <Stack spacing={2.5}>
      <StepActions
        left={t('setup.roomsFoot')}
        onBack={() => go(4)}
        onNext={() => go(6)}
        nextLabel={t('common.continue')}
      />
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h3">{t('setup.roomsTitle')}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
          {t('setup.roomsHint')}
        </Typography>
        <RoomsSection schoolId={ctx.school.id} />
      </Paper>
    </Stack>
  )
}

// The sections, reached from the settings nav in the sidebar (AppShell)
const TABS = ['school', 'roles', 'schedule', 'structure', 'years', 'hours', 'rooms'] as const

function Settings() {
  const { t } = useI18n()
  const ctx = useContext(SchoolContext)!
  const search = Route.useSearch()
  const { tab } = search
  const current = (TABS as readonly string[]).includes(tab ?? '') ? tab! : 'school'
  // The year's sections say which year they change
  const yearScoped = current === 'hours'
  const title = t(`settings.tab.${current}`)

  return (
    <AppShell title={title}>
      <PageIntro
        title={title}
        subtitle={yearScoped && ctx.year ? t('settings.forYear', { name: ctx.year.name }) : t(`settings.hint.${current}`)}
      />
      {current === 'school' && <SchoolInfo />}
      {current === 'roles' && <RolesSection roleId={search.role} />}
      {current === 'schedule' && <ScheduleSettings />}
      {current === 'structure' && <StructureSection />}
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
  return (
    <Box sx={{ maxWidth: 640 }}>
      <SchoolIdentity />
    </Box>
  )
}

// Name, city, address, founding date: schools.name + schools.settings
function SchoolIdentity() {
  const { t } = useI18n()
  const ctx = useContext(SchoolContext)!
  const router = useRouter()
  const queryClient = useQueryClient()
  const s = ctx.school.settings as { city?: string; address?: string; founded_on?: string | null }
  const initial = { name: ctx.school.name, city: s.city ?? '', address: s.address ?? '', founded: s.founded_on ?? '' }
  const [form, setForm] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k].trim() !== initial[k])
  const save = useMutation({
    mutationFn: async () =>
      must(
        await supabase
          .from('schools')
          .update({
            name: form.name.trim(),
            settings: {
              ...(ctx.school.settings as Record<string, unknown>),
              city: form.city.trim(),
              address: form.address.trim(),
              founded_on: form.founded || null,
            } as Json,
          })
          .eq('id', ctx.school.id),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      await router.invalidate()
    },
  })
  const field = (k: keyof typeof initial) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      save.reset()
      setForm({ ...form, [k]: e.target.value })
    },
  })
  return (
    <Card>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {t('setup.schoolTitle')}
      </Typography>
      <Stack spacing={2}>
        <TextField label={t('setup.schoolName')} required {...field('name')} />
        <TextField label={t('setup.city')} {...field('city')} />
        <TextField label={t('setup.address')} multiline minRows={2} {...field('address')} />
        <TextField label={t('setup.founded')} type="date" slotProps={{ inputLabel: { shrink: true } }} {...field('founded')} />
        {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
        {save.isSuccess && !dirty && <Alert severity="success">{t('common.saved')}</Alert>}
        <Box>
          <Button variant="contained" disabled={!dirty || !form.name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </Box>
      </Stack>
    </Card>
  )
}

// Horaires per cycle: every cycle of the school gets one (missing ones are
// prefilled), saved into schools.settings.schedules.
function ScheduleSettings() {
  const { t, locale } = useI18n()
  const ctx = useContext(SchoolContext)!
  const router = useRouter()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const cycles = (nodes.data ?? []).filter((n) => n.kind === 'cycle' && n.code)
  const [draft, setDraft] = useState<Horaire[] | null>(null)

  useEffect(() => {
    if (!nodes.data || draft) return
    const stored = readHoraires(ctx.school.settings)
    const fallback = stored.find((h) => h.cycles.length === 0)
    const list = cycles.map((c) => {
      const own = stored.find((h) => h.cycles.includes(c.code!))
      if (own) return own
      // Legacy single opening: each cycle starts from it
      if (fallback) return { ...structuredClone(fallback), id: c.code!, name: c.name, cycles: [c.code!] }
      return presetHoraire(c.code!, c.name)
    })
    setDraft(list.length ? list : stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.data])

  const save = useMutation({
    mutationFn: async (list: Horaire[]) => {
      const settings: Record<string, unknown> = { ...(ctx.school.settings as Record<string, unknown>), schedules: list }
      delete settings.opening
      must(await supabase.from('schools').update({ settings: settings as Json }).eq('id', ctx.school.id))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      await router.invalidate()
    },
  })

  if (nodes.isPending || !draft) return <Loading rows={5} />
  const shown = draft.map((h) => {
    const c = cycles.find((x) => h.cycles.includes(x.code!))
    return c ? { ...h, name: nodeName(c, locale) } : h
  })
  const invalid = draft.some((h) => h.days.length === 0 || weeklyTeachable(h) <= 0)
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ flex: 1, color: tokens.inkMuted, fontSize: 14 }}>{t('sched.settingsHint')}</Typography>
        <Button
          variant="contained"
          disabled={!ctx.isAdmin || invalid}
          loading={save.isPending}
          onClick={() => save.mutate(draft.map((h) => ({ ...h, name: cycles.find((c) => h.cycles.includes(c.code!))?.name ?? h.name })))}
        >
          {t('common.save')}
        </Button>
      </Stack>
      {save.isSuccess && !save.isPending && <Alert severity="success">{t('sched.saved')}</Alert>}
      {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
      <ScheduleEditor
        value={shown}
        onChange={(list) => {
          save.reset()
          setDraft(list)
        }}
      />
    </Stack>
  )
}
