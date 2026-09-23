import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '#/lib/supabase/client'
import { must, errorMessage } from '#/lib/errors'
import { rememberSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { TEMPLATE } from '#/features/structure/api'
import { tokens } from '#/theme/theme'
import { presetHoraire, weeklyTeachable, type Horaire } from './schedule'
import { ScheduleEditor } from './ScheduleEditor'

type TplNode = { kind: string; code: string; name: string; name_ar?: string; children?: TplNode[] }

function slugify(s: string) {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'ecole'
  )
}

export function CreateSchool({ step, onStep }: { step: 1 | 2; onStep: (s: number) => void }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [founded, setFounded] = useState('')
  const [cycles, setCycles] = useState<string[]>([])
  // One horaire per chosen cycle, prefilled from the cycle's usual day
  const [horaires, setHoraires] = useState<Horaire[]>([])
  const [offLevels, setOffLevels] = useState<string[]>([])
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const template = useQuery({
    queryKey: ['template', TEMPLATE],
    queryFn: async () =>
      must(await supabase.from('curriculum_templates').select('tree').eq('code', TEMPLATE).single()).tree as TplNode[],
  })

  const levelCount = useMemo(
    () =>
      (template.data ?? [])
        .filter((c) => cycles.includes(c.code))
        .flatMap((c) => c.children ?? [])
        .filter((l) => !offLevels.includes(l.code)).length,
    [template.data, cycles, offLevels],
  )

  const cycleName = (c: TplNode) => (locale === 'ar' && c.name_ar ? c.name_ar : c.name)
  const toggleCycle = (c: TplNode) => {
    const on = cycles.includes(c.code)
    setCycles((cs) => (on ? cs.filter((x) => x !== c.code) : [...cs, c.code]))
    if (!on && !horaires.some((h) => h.cycles.includes(c.code))) setHoraires((hs) => [...hs, presetHoraire(c.code, c.name)])
  }
  // Template order, only the cycles still checked
  const chosenHoraires = (template.data ?? [])
    .filter((c) => cycles.includes(c.code))
    .map((c) => horaires.find((h) => h.cycles.includes(c.code)))
    .filter((h): h is Horaire => !!h)
  const noTime = chosenHoraires.some((h) => h.days.length === 0 || weeklyTeachable(h) <= 0)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const schoolId = must(
        await supabase.rpc('create_school', {
          p_name: name,
          p_slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
          p_settings: {
            city,
            address,
            founded_on: founded || null,
            levels_offered: cycles,
            schedules: chosenHoraires,
          },
        }),
      ) as string
      must(
        await supabase.rpc('instantiate_curriculum_cycles', {
          p_school_id: schoolId,
          p_template_code: TEMPLATE,
          p_cycle_codes: cycles,
        }),
      )
      if (offLevels.length) await removeLevels(schoolId, offLevels)
      rememberSchool(schoolId)
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      navigate({ to: '/setup', search: { step: 3 } })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  if (step === 1) {
    return (
      <Stack spacing={2.5}>
        <StepActions
          left={t('setup.step1Foot')}
          onNext={() => onStep(2)}
          nextDisabled={!name.trim()}
          nextLabel={t('common.continue')}
        />
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h3">{t('setup.schoolTitle')}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
            {t('setup.schoolHint')}
          </Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField label={t('setup.schoolName')} value={name} onChange={(e) => setName(e.target.value)} required />
            <TextField
              label={t('setup.founded')}
              type="date"
              value={founded}
              onChange={(e) => setFounded(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField label={t('setup.address')} value={address} onChange={(e) => setAddress(e.target.value)} />
            <TextField label={t('setup.city')} value={city} onChange={(e) => setCity(e.target.value)} />
          </Box>
        </Paper>
      </Stack>
    )
  }

  return (
    <Stack spacing={2.5}>
      {!!error && <Alert severity="error">{errorMessage(error, t)}</Alert>}
      <StepActions
        left={t('setup.levelsCount', { n: levelCount })}
        onBack={() => onStep(1)}
        onNext={create}
        nextDisabled={cycles.length === 0 || levelCount === 0 || noTime}
        busy={busy}
        nextLabel={t('setup.createSchool')}
      />
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h3">{t('setup.levelsTitle')}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
          {t('setup.levelsHint')}
        </Typography>
        {template.isPending && <Typography>…</Typography>}
        <Stack spacing={1.5}>
          {(template.data ?? []).map((c) => {
            const on = cycles.includes(c.code)
            return (
              <Paper
                key={c.code}
                variant="outlined"
                sx={{ p: 2, borderColor: on ? tokens.accent : tokens.lineSoft, bgcolor: on ? '#F4F9F7' : '#fff' }}
              >
                <FormGroup>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={on}
                        onChange={() => toggleCycle(c)}
                      />
                    }
                    label={<Typography sx={{ fontWeight: 600 }}>{cycleName(c)}</Typography>}
                  />
                </FormGroup>
                {on && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1, pl: 4 }}>
                    {(c.children ?? []).map((l) => {
                      const kept = !offLevels.includes(l.code)
                      return (
                        <Chip
                          key={l.code}
                          size="small"
                          label={locale === 'ar' && l.name_ar ? l.name_ar : l.name}
                          color={kept ? 'primary' : 'default'}
                          variant={kept ? 'filled' : 'outlined'}
                          aria-pressed={kept}
                          onClick={() =>
                            setOffLevels((ls) => (kept ? [...ls, l.code] : ls.filter((x) => x !== l.code)))
                          }
                        />
                      )
                    })}
                  </Stack>
                )}
              </Paper>
            )
          })}
        </Stack>
      </Paper>
      {chosenHoraires.length > 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h3">{t('setup.hoursTitle')}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5, mt: 0.5 }}>
            {t(chosenHoraires.length > 1 ? 'sched.hintMany' : 'setup.hoursHint')}
          </Typography>
          <ScheduleEditor
            value={chosenHoraires.map((h) => {
              const c = template.data?.find((x) => h.cycles.includes(x.code))
              return c ? { ...h, name: cycleName(c) } : h
            })}
            onChange={(list) =>
              setHoraires((hs) => hs.map((h) => {
                const edited = list.find((x) => x.id === h.id)
                // names stay as stored (French content), only the display is localized
                return edited ? { ...edited, name: h.name } : h
              }))
            }
          />
        </Paper>
      )}
    </Stack>
  )
}

// Removes unchecked levels and their sub-branches (deepest first: the parent
// foreign key has no cascade).
async function removeLevels(schoolId: string, codes: string[]) {
  const nodes = must(
    await supabase.from('curriculum_nodes').select('id, code, path').eq('school_id', schoolId),
  )
  const roots = nodes.filter((n) => n.code && codes.includes(n.code)).map((n) => n.id)
  const doomed = nodes
    .filter((n) => n.path.some((p: string) => roots.includes(p)))
    .sort((a, b) => b.path.length - a.path.length)
  for (const n of doomed) must(await supabase.from('curriculum_nodes').delete().eq('id', n.id))
}

export function StepActions({
  left,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
}: {
  left?: string
  onBack?: () => void
  onNext: () => void
  nextLabel: string
  nextDisabled?: boolean
  busy?: boolean
}) {
  const { t } = useI18n()
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Typography sx={{ flex: 1, color: tokens.inkMuted, fontSize: 13.5 }}>{left}</Typography>
      {onBack && (
        <Button variant="outlined" onClick={onBack}>
          {t('common.back')}
        </Button>
      )}
      <Button variant="contained" onClick={onNext} disabled={nextDisabled} loading={busy}>
        {nextLabel}
      </Button>
    </Stack>
  )
}
