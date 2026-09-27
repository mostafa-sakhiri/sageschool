import { useMemo } from 'react'
import { z } from 'zod'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { classesQuery } from '#/features/classes/api'
import { AnnouncementForm, type AnnouncementPrefill } from '#/features/announcements/AnnouncementForm'
import { matchOne } from '../resolve'
import { DoneCard, FormCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  title: z.string().describe('Titre court'),
  body: z.string().describe("Le message aux parents, rédigé poliment, dans la langue de l'utilisateur"),
  priority: z.enum(['normal', 'important', 'urgent']).optional(),
  classNames: z.array(z.string()).optional().describe('Classes visées (noms exacts) ; vide = toute l’école'),
})
type Args = z.infer<typeof parameters>

// A5: "Annonce aux parents : école fermée vendredi"
export function AnnouncementTool() {
  useHumanInTheLoop({
    name: 'draftAnnouncement',
    description:
      "Rédiger une annonce aux parents : ouvre le formulaire pré-rempli dans le chat. L'utilisateur relit, puis l'enregistre en brouillon ou la publie lui-même.",
    parameters,
    render: AnnouncementCard,
  })
  return null
}

function AnnouncementCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t } = useI18n()
  const settle = useSettle(props.respond)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; published?: boolean; title?: string }>(props.result)
    return (
      <DoneCard
        ok={r?.status === 'saved'}
        label={t(r?.published ? 'assistant.done.announcementPublished' : 'assistant.done.announcementDraft', { title: r?.title ?? '' })}
        action={
          <OpenButton to="/announcements" />
        }
      />
    )
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  const a = props.args as Args
  return (
    <AnnouncementDraft
      args={a}
      onSaved={(published) => settle({ status: 'saved', published, title: a.title })}
      onCancel={() => settle({ status: 'cancelled' })}
    />
  )
}

function AnnouncementDraft({ args, onSaved, onCancel }: { args: Args; onSaved: (published: boolean) => void; onCancel: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const matched = useMemo(() => (args.classNames ?? []).map((n) => ({ n, m: matchOne(classes.data ?? [], (c) => c.name, n) })), [classes.data, args.classNames])
  const prefill = useMemo<AnnouncementPrefill | null>(
    () =>
      classes.isPending && ctx.year
        ? null
        : { title: args.title, body: args.body, priority: args.priority, classIds: matched.flatMap((x) => (x.m.item ? [x.m.item.id] : [])) },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the arguments are final once the card executes
    [classes.isPending, ctx.year, matched],
  )
  if (!prefill) return <PendingCard label={t('assistant.preparing')} />
  const unknown = matched.filter((x) => !x.m.item).map((x) => x.n)
  return (
    <FormCard notes={[unknown.length ? t('assistant.classNotFound', { name: unknown.join(', ') }) : null]}>
      <AnnouncementForm
        initial={null}
        prefill={prefill}
        onClose={onCancel}
        onSaved={(_, published) => onSaved(published)}
        // Published from the chat: its WhatsApp send-out is on the page
        onPublished={() => navigate({ to: '/announcements' })}
      />
    </FormCard>
  )
}
