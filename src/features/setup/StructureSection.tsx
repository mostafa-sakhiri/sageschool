import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import { Loading } from '#/components/states'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import type { Json } from '#/lib/database.types'
import { errorMessage, must } from '#/lib/errors'
import { useSchool } from '#/lib/session'
import { TEMPLATE, leafNodes, nodeName, nodesQuery, type Node } from '#/features/structure/api'
import { classesQuery } from '#/features/classes/api'
import { todayIso } from '#/lib/format'
import { presetHoraire, readHoraires } from './schedule'
import { tokens } from '#/theme/theme'

export type TplNode = { kind: string; code: string; name: string; name_ar?: string; children?: TplNode[] }
// What opening a cycle or a level did, for the summary
export type Opened = { cycle: TplNode; horaireCreated: boolean; added: Node[]; leaves: Node[]; years: string[]; subjects: number }

// Réglages › Structure: every cycle of the programme, open or not. An open
// cycle's levels are chips (click to open or close one); a closed cycle
// opens in one click. Opening brings everything the cycle needs: its
// horaire, the subjects and their hours for the current and coming years,
// and (one more click in the summary) a class per level. Closing is refused
// while classes still use the level.
export function StructureSection() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const router = useRouter()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const template = useQuery({
    queryKey: ['template', TEMPLATE],
    queryFn: async () =>
      must(await supabase.from('curriculum_templates').select('tree').eq('code', TEMPLATE).single()).tree as TplNode[],
  })
  const [closing, setClosing] = useState<{ code: string; name: string; cycle: boolean } | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const name = (n: { name: string; name_ar?: string | null }) => (locale === 'ar' && n.name_ar ? n.name_ar : n.name)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    await router.invalidate()
  }

  const open = useOpenCurriculum((summary) => setOpened(summary))
  const close = useMutation({
    mutationFn: async (code: string) => {
      const node = nodes.data?.find((n) => n.code === code)
      if (node) must(await supabase.rpc('remove_curriculum_node', { p_node_id: node.id }))
    },
    onSuccess: async () => {
      setClosing(null)
      await refresh()
    },
  })

  if (nodes.isPending || template.isPending) return <Loading rows={6} />
  const has = new Set((nodes.data ?? []).map((n) => n.code))
  const error = open.error ?? close.error

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: tokens.inkMuted, fontSize: 14 }}>{t('structure.intro')}</Typography>
      {error && !closing && <Alert severity="error">{errorMessage(error, t)}</Alert>}
      {(template.data ?? []).map((c) => {
        const on = has.has(c.code)
        const levels = c.children ?? []
        const openLevels = levels.filter((l) => has.has(l.code))
        return (
          <Paper
            key={c.code}
            variant="outlined"
            sx={{ p: 2, borderColor: on ? tokens.accentLine : tokens.lineSoft, bgcolor: on ? tokens.card : tokens.fill }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, mb: on ? 1.5 : 0 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h5" sx={{ color: on ? tokens.ink : tokens.inkMuted }}>
                  {name(c)}
                </Typography>
                <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>
                  {on ? t('structure.levelsOpen', { n: openLevels.length, total: levels.length }) : t('structure.notOpen')}
                </Typography>
              </Box>
              {on ? (
                <Button size="small" color="inherit" onClick={() => setClosing({ code: c.code, name: name(c), cycle: true })}>
                  {t('structure.closeCycle')}
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  startIcon={<AddOutlined />}
                  loading={open.isPending && open.variables?.cycle.code === c.code}
                  onClick={() => open.mutate({ codes: [c.code], cycle: c })}
                >
                  {t('structure.openCycle')}
                </Button>
              )}
            </Stack>
            {on && (
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {levels.map((l) => {
                  const kept = has.has(l.code)
                  const subs = (l.children ?? []).filter((x) => has.has(x.code)).map(name)
                  return (
                    <Chip
                      key={l.code}
                      icon={kept ? <CheckOutlined /> : <AddOutlined />}
                      label={subs.length ? `${name(l)} · ${subs.join(', ')}` : name(l)}
                      color={kept ? 'primary' : 'default'}
                      variant={kept ? 'filled' : 'outlined'}
                      disabled={open.isPending || close.isPending}
                      onClick={() =>
                        kept ? setClosing({ code: l.code, name: name(l), cycle: false }) : open.mutate({ codes: [l.code], cycle: c })
                      }
                      aria-pressed={kept}
                      sx={{ maxWidth: '100%' }}
                    />
                  )
                })}
              </Stack>
            )}
          </Paper>
        )
      })}

      {opened && <OpenedDialog summary={opened} onClose={() => setOpened(null)} />}
      {closing && (
        <Dialog open onClose={() => setClosing(null)} fullWidth maxWidth="xs">
          <DialogTitle>{t(closing.cycle ? 'structure.closeCycleTitle' : 'structure.closeLevelTitle', { name: closing.name })}</DialogTitle>
          <DialogContent>
            <Typography>{t('structure.closeHint')}</Typography>
            {close.isError && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {errorMessage(close.error, t)}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => (close.reset(), setClosing(null))}>{t('common.cancel')}</Button>
            <Button variant="contained" color="error" loading={close.isPending} onClick={() => close.mutate(closing.code)}>
              {t('structure.close')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  )
}

// Opens cycles or levels of the programme with everything they need: the
// nodes, the cycle's horaire if it has none, the subjects and hours for
// every year not over yet. Returns what was done (for the summary). Shared
// by Réglages › Structure and the assistant.
export function useOpenCurriculum(onOpened?: (summary: Opened) => void) {
  const ctx = useSchool()
  const router = useRouter()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  return useMutation({
    mutationFn: async ({ codes, cycle }: { codes: string[]; cycle: TplNode }): Promise<Opened> => {
      const before = new Set((nodes.data ?? []).map((n) => n.id))
      must(await supabase.rpc('add_curriculum_nodes', { p_school_id: ctx.school.id, p_template_code: TEMPLATE, p_codes: codes }))
      // The cycle's horaire, if it has none yet
      const horaires = readHoraires(ctx.school.settings)
      const horaireCreated = !horaires.some((h) => h.cycles.includes(cycle.code))
      if (horaireCreated) {
        const settings = { ...(ctx.school.settings as Record<string, unknown>), schedules: [...horaires, presetHoraire(cycle.code, cycle.name)] }
        must(await supabase.from('schools').update({ settings: settings as Json }).eq('id', ctx.school.id))
      }
      // Subjects and their hours for every year not over yet
      const today = todayIso()
      const years = ctx.years.filter((y) => y.ends_on >= today)
      for (const y of years)
        must(
          await supabase.rpc('apply_curriculum_template_hours', {
            p_school_id: ctx.school.id,
            p_academic_year_id: y.id,
            p_template_code: TEMPLATE,
            p_only_under: codes,
          }),
        )
      // What was added: its levels (where classes go) and their subjects
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'nodes'] })
      const all = await queryClient.fetchQuery(nodesQuery(ctx.school.id))
      const under = all.filter((n) => codes.some((c) => n.path.some((id) => all.find((x) => x.id === id)?.code === c)))
      const added = under.filter((n) => !before.has(n.id))
      const leaves = leafNodes(all).filter((n) => under.some((u) => u.id === n.id))
      const subjects = years.length
        ? new Set(
            must(
              await supabase
                .from('node_subject_hours')
                .select('subject_id')
                .eq('academic_year_id', years[0].id)
                .in('node_id', under.map((n) => n.id))
                .gt('weekly_minutes', 0),
            ).map((x) => x.subject_id),
          ).size
        : 0
      return { cycle, horaireCreated, added, leaves, years: years.map((y) => y.name), subjects }
    },
    onSuccess: async (summary) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      await router.invalidate()
      onOpened?.(summary)
    },
  })
}

const LETTERS = 'ABCDEFGHIJ'

// After opening: what is ready, links to check it, and the one step left
// (classes), done here in one click if wanted.
export function OpenedDialog({ summary, onClose }: { summary: Opened; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const name = (n: { name: string; name_ar?: string | null }) => (locale === 'ar' && n.name_ar ? n.name_ar : n.name)
  const levels = summary.added.filter((n) => n.kind === 'level')
  // Levels (or their tracks) that still have no class this year
  const without = summary.leaves.filter((l) => !(classes.data ?? []).some((c) => c.node_id === l.id))
  const nameFor = (leaf: Node, taken: Set<string>) => {
    const base = nodeName(leaf, 'fr')
    let i = 0
    while (taken.has(`${base} ${LETTERS[i] ?? i + 1}`)) i++
    return `${base} ${LETTERS[i] ?? i + 1}`
  }
  const create = useMutation({
    mutationFn: async () => {
      const taken = new Set((classes.data ?? []).map((c) => c.name))
      const rows = without.map((l) => {
        const n = nameFor(l, taken)
        taken.add(n)
        return { school_id: ctx.school.id, academic_year_id: ctx.year!.id, node_id: l.id, name: n, capacity: 28 }
      })
      must(await supabase.from('classes').insert(rows))
      return rows.map((r) => r.name)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] }),
  })
  const go = (to: string, search?: Record<string, string>) => {
    onClose()
    navigate({ to, search } as never)
  }
  const Done = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', py: 0.75 }}>
      <CheckCircleOutlined sx={{ color: tokens.accent, fontSize: 20, mt: 0.1 }} />
      <Box sx={{ flex: 1, fontSize: 14 }}>{children}</Box>
      {action}
    </Stack>
  )

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('structure.openedTitle', { name: name(summary.cycle) })}</DialogTitle>
      <DialogContent>
        <Done>
          {levels.length
            ? t('structure.openedLevels', { n: levels.length, list: levels.map(name).join(', ') })
            : t('structure.openedNothingNew')}
        </Done>
        <Done action={<Button size="small" onClick={() => go('/setup', { tab: 'schedule' })}>{t('structure.see')}</Button>}>
          {summary.horaireCreated ? t('structure.openedHoraireNew') : t('structure.openedHoraireKept')}
        </Done>
        <Done action={summary.years.length > 0 && <Button size="small" onClick={() => go('/setup', { tab: 'hours' })}>{t('structure.see')}</Button>}>
          {!summary.years.length
            ? t('structure.openedNoYear')
            : summary.subjects
              ? t('structure.openedSubjects', { n: summary.subjects, years: summary.years.join(', ') })
              : t('structure.openedNoHours')}
        </Done>

        <Box sx={{ mt: 1.5, p: 1.5, borderRadius: '8px', border: `1px solid ${create.isSuccess ? tokens.accentLine : tokens.warnLine}`, bgcolor: create.isSuccess ? tokens.accentSoft : tokens.warnSoft }}>
          {create.isSuccess ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <CheckCircleOutlined sx={{ color: tokens.accent, fontSize: 20 }} />
              <Typography sx={{ flex: 1, fontSize: 14 }}>{t('structure.classesCreated', { list: create.data.join(', ') })}</Typography>
              <Button size="small" onClick={() => go('/classes')}>
                {t('structure.see')}
              </Button>
            </Stack>
          ) : (
            <>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: without.length && ctx.year ? 1 : 0 }}>
                <RadioButtonUncheckedOutlined sx={{ color: tokens.warnInk, fontSize: 20 }} />
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                  {!ctx.year
                    ? t('structure.classesNoYear')
                    : without.length
                      ? t('structure.classesMissing', { n: without.length })
                      : t('structure.classesAll')}
                </Typography>
              </Stack>
              {ctx.year && without.length > 0 && (
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', pl: 4 }}>
                  <Button variant="contained" size="small" loading={create.isPending || classes.isPending} onClick={() => create.mutate()}>
                    {t('structure.createClasses', {
                      list: (() => {
                        const taken = new Set((classes.data ?? []).map((c) => c.name))
                        return without
                          .slice(0, 4)
                          .map((l) => {
                            const n = nameFor(l, taken)
                            taken.add(n)
                            return n
                          })
                          .join(', ') + (without.length > 4 ? '…' : '')
                      })(),
                    })}
                  </Button>
                  <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{t('structure.classesHint', { year: ctx.year.name })}</Typography>
                </Stack>
              )}
            </>
          )}
          {create.isError && <Alert severity="error" sx={{ mt: 1 }}>{errorMessage(create.error, t)}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{create.isSuccess || !without.length ? t('common.close') : t('structure.later')}</Button>
      </DialogActions>
    </Dialog>
  )
}
