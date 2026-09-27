import { useState } from 'react'
import { z } from 'zod'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { InviteDialog } from '#/features/team/InviteDialog'
import { DoneCard, FormCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  fullName: z.string(),
  email: z.string().optional().describe('Adresse e-mail de connexion'),
  phone: z.string().optional(),
  role: z.enum(['teacher', 'staff', 'admin']).describe('teacher: professeur ; staff: secrétariat ; admin: direction'),
})
type Args = z.infer<typeof parameters>

// A6 (admin only): "Ajoute Nadia Fassi comme prof, nadia@…"
export function InviteTool() {
  useHumanInTheLoop({
    name: 'inviteMember',
    description: "Ajouter un membre de l'équipe (professeur, secrétariat, direction) : ouvre le formulaire pré-rempli dans le chat ; l'utilisateur vérifie et crée le compte.",
    parameters,
    render: InviteCard,
  })
  return null
}

function InviteCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const settle = useSettle(props.respond)
  // The temporary password shows after creation: the card is answered only
  // when the person closes it, once they have noted it.
  const [created, setCreated] = useState(false)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; name?: string }>(props.result)
    return (
      <DoneCard
        ok={r?.status === 'saved'}
        label={t('assistant.done.member', { name: r?.name ?? '' })}
        action={
          <OpenButton to="/team" />
        }
      />
    )
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  const a = props.args as Args
  return (
    <FormCard>
      <InviteDialog
        open
        schoolId={ctx.school.id}
        roles={['teacher', 'staff', 'admin']}
        title={t('team.add')}
        defaultName={a.fullName}
        defaultEmail={a.email ?? ''}
        defaultPhone={a.phone ?? ''}
        defaultRole={a.role}
        onCreated={() => setCreated(true)}
        onClose={() => settle(created ? { status: 'saved', name: a.fullName } : { status: 'cancelled' })}
      />
    </FormCard>
  )
}
