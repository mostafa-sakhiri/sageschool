import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { TEMPLATE, nodesQuery } from '#/features/structure/api'
import { OpenedDialog, useOpenCurriculum, type Opened, type TplNode } from '#/features/setup/StructureSection'
import { tokens } from '#/theme/theme'
import { matchOne } from '../resolve'
import { DoneCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  name: z.string().describe("Le cycle ou le niveau à ouvrir, tel que l'utilisateur le dit (« collège », « lycée », « tronc commun », « petite section »…)"),
})
type Args = z.infer<typeof parameters>

// "Ouvre le collège": the cycle (or the level) from the Moroccan programme,
// with its horaire, subjects and hours; then the same summary as in
// Réglages › Structure (and the class per level in one click). Admin only.
export function OpenCycleTool() {
  useHumanInTheLoop({
    name: 'openCycle',
    description:
      "Ouvrir dans l'école un cycle ou un niveau du programme marocain (préscolaire, primaire, collège, lycée, ou un niveau précis) avec son horaire, ses matières et volumes horaires. Une carte demande confirmation.",
    parameters,
    render: CycleCard,
  })
  return null
}

function CycleCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t } = useI18n()
  const settle = useSettle(props.respond)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; name?: string }>(props.result)
    return <DoneCard ok={r?.status === 'saved'} label={t('assistant.done.cycle', { name: r?.name ?? '' })} action={<OpenButton to="/setup" search={{ tab: 'structure' }} />} />
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  return <CycleConfirm args={props.args as Args} onDone={(name) => settle({ status: 'saved', name })} onCancel={() => settle({ status: 'cancelled' })} />
}

function CycleConfirm({ args, onDone, onCancel }: { args: Args; onDone: (name: string) => void; onCancel: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const [summary, setSummary] = useState<Opened | null>(null)
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const template = useQuery({
    queryKey: ['template', TEMPLATE],
    queryFn: async () => must(await supabase.from('curriculum_templates').select('tree').eq('code', TEMPLATE).single()).tree as TplNode[],
  })
  const open = useOpenCurriculum(setSummary)
  const name = (n: { name: string; name_ar?: string | null }) => (locale === 'ar' && n.name_ar ? n.name_ar : n.name)
  // Cycles and their levels, with the cycle each belongs to
  const choices = useMemo(
    () => (template.data ?? []).flatMap((c) => [{ node: c, cycle: c }, ...(c.children ?? []).map((l) => ({ node: l, cycle: c }))]),
    [template.data],
  )
  const match = useMemo(() => matchOne(choices, (x) => [x.node.name, x.node.name_ar], args.name), [choices, args.name])

  if (!ctx.isAdmin) return <Alert severity="info" action={<Button color="inherit" size="small" onClick={onCancel}>{t('common.close')}</Button>}>{t('assistant.adminOnly')}</Alert>
  if (template.isPending || nodes.isPending) return <PendingCard label={t('assistant.preparing')} />
  if (summary) return <OpenedDialog summary={summary} onClose={() => onDone(name(summary.cycle))} />
  if (!match.item)
    return (
      <Alert severity="warning" action={<Button color="inherit" size="small" onClick={onCancel}>{t('common.cancel')}</Button>}>
        {match.candidates.length
          ? t('assistant.cycleAmbiguous', { name: args.name, list: match.candidates.map((x) => name(x.node)).join(', ') })
          : t('assistant.cycleNotFound', { name: args.name })}
      </Alert>
    )
  const { node, cycle } = match.item
  const already = (nodes.data ?? []).some((n) => n.code === node.code)
  const levels = node === cycle ? (cycle.children ?? []) : [node]
  return (
    <Box sx={{ p: 1.5, borderRadius: 3, border: `1px solid ${tokens.line}`, bgcolor: tokens.card }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{t('assistant.cycleOpenTitle', { name: name(node) })}</Typography>
      <Typography sx={{ fontSize: 13, color: tokens.inkMuted, mt: 0.5 }}>
        {already ? t('assistant.cycleAlready', { name: name(node) }) : t('assistant.cycleWhat', { levels: levels.map(name).join(', ') })}
      </Typography>
      {open.isError && <Alert severity="error" sx={{ mt: 1 }}>{errorMessage(open.error, t)}</Alert>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1.25 }}>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="contained" loading={open.isPending} onClick={() => open.mutate({ codes: [node.code], cycle })}>
          {already ? t('assistant.cycleComplete') : t('structure.openCycle')}
        </Button>
      </Stack>
    </Box>
  )
}
