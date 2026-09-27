import { useMemo } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { PreregDialog } from '#/features/preregistrations/PreregDialog'
import type { Prereg } from '#/features/preregistrations/api'
import { matchOne, normDate } from '../resolve'
import { DoneCard, FormCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  childFirstName: z.string(),
  childLastName: z.string().describe("Nom de l'enfant ; souvent celui du parent s'il n'est pas précisé"),
  birthDate: z.string().optional().describe('AAAA-MM-JJ'),
  level: z.string().optional().describe('Niveau demandé, nom tel que dans la liste des niveaux du contexte'),
  parentName: z.string(),
  parentPhone: z.string().optional(),
  parentEmail: z.string().optional(),
  source: z.string().optional().describe("Comment la famille a connu l'école"),
  notes: z.string().optional(),
  nextFollowupOn: z.string().optional().describe('Date de la prochaine relance, AAAA-MM-JJ'),
})
type Args = z.infer<typeof parameters>

// A2: a family asks for a place ("M. Bennani 0661… veut inscrire son fils en CP")
export function PreregTool() {
  useHumanInTheLoop({
    name: 'createPreregistration',
    description:
      "Enregistrer une préinscription (une famille intéressée, pas encore inscrite) : ouvre la fiche pré-remplie dans le chat, l'utilisateur vérifie et enregistre.",
    parameters,
    render: PreregCard,
  })
  return null
}

function PreregCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t } = useI18n()
  const settle = useSettle(props.respond)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; name?: string }>(props.result)
    return (
      <DoneCard
        ok={r?.status === 'saved'}
        label={t('assistant.done.prereg', { name: r?.name ?? '' })}
        action={
          <OpenButton to="/preregistrations" />
        }
      />
    )
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  const a = props.args as Args
  return <PreregForm args={a} onSaved={() => settle({ status: 'saved', name: `${a.childFirstName} ${a.childLastName}` })} onCancel={() => settle({ status: 'cancelled' })} />
}

function PreregForm({ args, onSaved, onCancel }: { args: Args; onSaved: () => void; onCancel: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const level = useMemo(() => {
    const all = nodes.data ?? []
    const levels = all.filter((n) => n.kind === 'level' || n.kind === 'cycle')
    return matchOne(levels, (n) => [n.name, n.name_ar, nodeLabel(n, all, 'fr'), nodeLabel(n, all, locale)], args.level)
  }, [nodes.data, args.level, locale])
  const initial = useMemo<Partial<Prereg> | null>(
    () =>
      nodes.isPending
        ? null
        : {
            child_first_name: args.childFirstName,
            child_last_name: args.childLastName,
            birth_date: normDate(args.birthDate),
            node_id: level.item?.id ?? null,
            parent_name: args.parentName,
            parent_phone: args.parentPhone ?? null,
            parent_email: args.parentEmail ?? null,
            source: args.source ?? null,
            notes: args.notes ?? null,
            next_followup_on: normDate(args.nextFollowupOn),
          },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the arguments are final once the card executes
    [nodes.isPending, level.item?.id],
  )
  if (!initial) return <PendingCard label={t('assistant.preparing')} />
  return (
    <FormCard notes={[args.level && !level.item ? t('assistant.levelNotFound', { name: args.level }) : null]}>
      <PreregDialog initial={initial} onClose={onCancel} onSaved={onSaved} />
    </FormCard>
  )
}
