import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import { Loading } from '#/components/states'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import type { Json } from '#/lib/database.types'
import { errorMessage, must } from '#/lib/errors'
import { useSchool } from '#/lib/session'
import { TEMPLATE, nodesQuery } from '#/features/structure/api'
import { presetHoraire, readHoraires } from './schedule'
import { tokens } from '#/theme/theme'

type TplNode = { kind: string; code: string; name: string; name_ar?: string; children?: TplNode[] }

// Réglages › Structure: every cycle of the programme, open or not. An open
// cycle's levels are chips (click to open or close one); a closed cycle
// opens in one click. Opening brings the cycle's horaire and this year's
// subject hours; closing is refused while classes still use the level.
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
  const name = (n: { name: string; name_ar?: string | null }) => (locale === 'ar' && n.name_ar ? n.name_ar : n.name)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    await router.invalidate()
  }

  const open = useMutation({
    mutationFn: async ({ codes, cycle }: { codes: string[]; cycle: TplNode }) => {
      must(await supabase.rpc('add_curriculum_nodes', { p_school_id: ctx.school.id, p_template_code: TEMPLATE, p_codes: codes }))
      // The cycle's horaire, if it has none yet
      const horaires = readHoraires(ctx.school.settings)
      if (!horaires.some((h) => h.cycles.includes(cycle.code))) {
        const settings = { ...(ctx.school.settings as Record<string, unknown>), schedules: [...horaires, presetHoraire(cycle.code, cycle.name)] }
        must(await supabase.from('schools').update({ settings: settings as Json }).eq('id', ctx.school.id))
      }
      // This year's subject hours for what was opened
      if (ctx.year)
        must(
          await supabase.rpc('apply_curriculum_template_hours', {
            p_school_id: ctx.school.id,
            p_academic_year_id: ctx.year.id,
            p_template_code: TEMPLATE,
            p_only_under: codes,
          }),
        )
    },
    onSuccess: refresh,
  })
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
