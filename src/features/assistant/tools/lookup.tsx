import { z } from 'zod'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Box, Stack, Typography } from '@mui/material'
import { useFrontendTool } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { fullName } from '#/components/ui'
import { formatDate } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
import { tokens } from '#/theme/theme'
import { matchOne, norm } from '../resolve'
import { OpenButton, parseResult, PendingCard } from './Card'

// A7: "Où en est Adam Bennani ?" — read-only, through the user's own RLS.
const findParams = z.object({ query: z.string().describe("Nom, prénom ou partie du nom de l'élève") })

type Found = { id: string; name: string; className: string | null; birthDate: string | null; parents: string[] }

// Results with their ids, for the card's links; the model only gets names.
const found = new Map<string, Found[]>()

export function FindStudentsTool() {
  const ctx = useSchool()
  const queryClient = useQueryClient()
  useFrontendTool(
    {
      name: 'findStudents',
      description: "Chercher des élèves de l'école par nom. Renvoie au plus 8 élèves avec leur classe de l'année et leurs parents.",
      parameters: findParams,
      handler: async ({ query }, { toolCall }) => {
        const all = await queryClient.fetchQuery(studentsQuery(ctx.school.id))
        const q = norm(query)
        const hits = matchOne(all, (s) => [fullName(s), `${s.last_name} ${s.first_name}`], query).candidates
        const rows = (hits.length ? hits : all.filter((s) => norm(fullName(s)).includes(q))).slice(0, 8)
        const students: Found[] = rows.map((s) => ({
          id: s.id,
          name: fullName(s),
          className: currentEnrollment(s, ctx.year?.id)?.class?.name ?? null,
          birthDate: s.birth_date,
          parents: s.guardians.map((g) => g.member?.user?.full_name ?? '').filter(Boolean),
        }))
        found.set(toolCall.id, students)
        return JSON.stringify({ count: students.length, students: students.map(({ id: _id, ...rest }) => rest) })
      },
      render: FindStudentsCard,
    },
    [ctx.school.id, ctx.year?.id],
  )
  return null
}

function FindStudentsCard(props: { status: string; toolCallId: string }) {
  const { t, locale } = useI18n()
  if (props.status !== 'complete') return <PendingCard label={t('assistant.searching')} />
  const list = found.get(props.toolCallId) ?? []
  if (!list.length) return <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('assistant.noStudentFound')}</Typography>
  return (
    <Stack sx={{ border: `1px solid ${tokens.line}`, borderRadius: 3, overflow: 'hidden' }}>
      {list.map((s, i) => (
        <Stack
          key={s.id}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', px: 1.5, py: 1, borderTop: i ? `1px solid ${tokens.lineSoft}` : 'none', bgcolor: tokens.surface }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap dir="auto" sx={{ fontSize: 13.5, fontWeight: 500 }}>
              {s.name}
            </Typography>
            <Typography noWrap sx={{ fontSize: 12, color: tokens.inkMuted }}>
              {[s.className ?? t('students.noClass'), s.birthDate ? formatDate(s.birthDate, locale) : null, s.parents.join(', ')].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <OpenButton to="/students" search={{ student: s.id }} />
        </Stack>
      ))}
    </Stack>
  )
}

// A8: "Montre les impayés", "ouvre l'emploi du temps de la PS"
const PAGES = {
  dashboard: '/',
  students: '/students',
  classes: '/classes',
  preregistrations: '/preregistrations',
  agenda: '/agenda',
  timetable: '/timetable',
  attendance: '/attendance',
  announcements: '/announcements',
  fees: '/fees',
  cases: '/cases',
  team: '/team',
  settings: '/setup',
} as const
type Page = keyof typeof PAGES

const openParams = z.object({
  page: z.enum(Object.keys(PAGES) as [Page, ...Page[]]),
  className: z.string().optional().describe("Pour l'emploi du temps : la classe à ouvrir (nom exact)"),
  edit: z.boolean().optional().describe("Pour l'emploi du temps : ouvrir l'éditeur (brouillon) plutôt que la semaine"),
})

export function OpenPageTool() {
  const ctx = useSchool()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useI18n()
  useFrontendTool(
    {
      name: 'openPage',
      description:
        "Ouvrir une page de l'application (le chat reste ouvert). Pour modifier un emploi du temps, ouvrir 'timetable' avec la classe et edit=true : les outils d'emploi du temps n'existent que sur cette page.",
      parameters: openParams,
      handler: async ({ page, className, edit }) => {
        if ((page === 'team' || page === 'settings') && !ctx.isAdmin) return JSON.stringify({ opened: false, reason: 'admin only' })
        if (page === 'fees' && !ctx.canFees) return JSON.stringify({ opened: false, reason: 'no access to fees' })
        if (page === 'timetable') {
          const classes = ctx.year ? await queryClient.fetchQuery(classesQuery(ctx.school.id, ctx.year.id)) : []
          const cls = matchOne(classes, (c) => c.name, className)
          if (className && !cls.item) return JSON.stringify({ opened: false, reason: `class not found: ${className}`, classes: classes.map((c) => c.name) })
          await navigate({ to: '/timetable', search: { classId: cls.item?.id, mode: edit ? 'edit' : undefined } })
          return JSON.stringify({ opened: true, page: t('nav.timetable'), className: cls.item?.name ?? null, mode: edit ? 'edit' : 'week' })
        }
        await navigate({ to: PAGES[page] })
        return JSON.stringify({ opened: true, page })
      },
      render: (props) =>
        props.status === 'complete' && parseResult<{ opened: boolean }>(props.result)?.opened ? (
          <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>↗ {t('assistant.pageOpened')}</Typography>
        ) : null,
    },
    [ctx.school.id, ctx.year?.id, ctx.isAdmin, ctx.canFees, t],
  )
  return null
}
