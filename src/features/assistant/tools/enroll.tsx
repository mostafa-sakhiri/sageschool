import { useMemo } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { classesQuery } from '#/features/classes/api'
import { AddStudentDialog, type StudentPrefill } from '#/features/students/AddStudentDialog'
import { matchOne, normDate } from '../resolve'
import { DoneCard, FormCard, OpenButton, parseResult, PendingCard, useSettle } from './Card'

const parameters = z.object({
  firstName: z.string().describe("Prénom de l'élève"),
  lastName: z.string().describe("Nom de famille de l'élève"),
  birthDate: z.string().optional().describe('Date de naissance, AAAA-MM-JJ'),
  gender: z.enum(['female', 'male']).optional(),
  className: z.string().optional().describe('Nom exact de la classe (liste dans le contexte)'),
})
type Args = z.infer<typeof parameters>

// A1: "Inscris Yasmine Alaoui, née le 3/3/2021, en petite section"
export function EnrollTool() {
  useHumanInTheLoop({
    name: 'enrollStudent',
    description:
      "Inscrire un nouvel élève : ouvre la fiche d'inscription pré-remplie dans le chat. L'utilisateur vérifie, complète (frais…) et enregistre.",
    parameters,
    render: EnrollCard,
  })
  return null
}

function EnrollCard(props: { args: Partial<Args>; status: string; respond?: (r: unknown) => Promise<void>; result?: string }) {
  const { t } = useI18n()
  const settle = useSettle(props.respond)
  if (props.status === 'complete') {
    const r = parseResult<{ status: string; studentId?: string; name?: string }>(props.result)
    return (
      <DoneCard
        ok={r?.status === 'saved'}
        label={t('assistant.done.enrolled', { name: r?.name ?? '' })}
        action={
          r?.studentId && (
            <OpenButton to="/students" search={{ student: r.studentId }} />
          )
        }
      />
    )
  }
  if (props.status !== 'executing') return <PendingCard label={t('assistant.preparing')} />
  return <EnrollForm args={props.args as Args} onSaved={(id, name) => settle({ status: 'saved', studentId: id, name })} onCancel={() => settle({ status: 'cancelled' })} />
}

function EnrollForm({ args, onSaved, onCancel }: { args: Args; onSaved: (id: string, name: string) => void; onCancel: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const cls = useMemo(() => matchOne(classes.data ?? [], (c) => c.name, args.className), [classes.data, args.className])
  // Built once the classes are known: the form reads its prefill when it opens
  const prefill = useMemo<StudentPrefill | null>(
    () =>
      classes.isPending && ctx.year
        ? null
        : { first: args.firstName, last: args.lastName, birth: normDate(args.birthDate) ?? undefined, gender: args.gender, classId: cls.item?.id },
    [classes.isPending, ctx.year, args.firstName, args.lastName, args.birthDate, args.gender, cls.item?.id],
  )
  if (!prefill) return <PendingCard label={t('assistant.preparing')} />
  return (
    <FormCard
      notes={[
        args.className && !cls.item ? t('assistant.classNotFound', { name: args.className }) : null,
        args.birthDate && !prefill.birth ? t('assistant.dateUnreadable', { value: args.birthDate }) : null,
      ]}
    >
      <AddStudentDialog open prefill={prefill} onClose={onCancel} onCreated={(id) => onSaved(id, `${args.firstName} ${args.lastName}`)} />
    </FormCard>
  )
}
