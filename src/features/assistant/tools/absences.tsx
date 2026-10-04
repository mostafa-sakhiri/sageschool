import { useState } from 'react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useFrontendTool } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { Tag, fullName } from '#/components/ui'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { formatDate } from '#/lib/format'
import { studentsQuery } from '#/features/students/api'
import { StudentAbsencesDialog, studentAbsencesQuery, yearPeriod } from '#/features/attendance/history'
import { tokens } from '#/theme/theme'
import { matchOne } from '../resolve'
import { parseResult, PendingCard } from './Card'

// "Combien d'absences non justifiées pour Salma ?" — read-only, through the
// user's own RLS (attendance.view_all).
const parameters = z.object({ student: z.string().describe("Nom de l'élève (prénom et nom)") })

type Answer = {
  found: boolean
  reason?: string
  candidates?: string[]
  name?: string
  from?: string
  to?: string
  days?: number
  unjustifiedDays?: number
  lates?: number
  // the last unjustified days, for the model to quote
  lastUnjustified?: string[]
}

// The student's id stays here, for the card's link (the model gets names only)
const ids = new Map<string, string>()

export function StudentAbsencesTool() {
  const ctx = useSchool()
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  useFrontendTool(
    {
      name: 'studentAbsences',
      description:
        "Les absences et retards d'un élève sur l'année scolaire : jours d'absence, combien non justifiés, retards, et les derniers jours non justifiés. Lecture seule.",
      parameters,
      handler: async ({ student }, { toolCall }) => {
        const all = await queryClient.fetchQuery(studentsQuery(ctx.school.id))
        const m = matchOne(all, (s) => [fullName(s), `${s.last_name} ${s.first_name}`], student)
        if (!m.item) {
          const answer: Answer = m.candidates.length
            ? { found: false, reason: 'ambiguous', candidates: m.candidates.slice(0, 6).map(fullName) }
            : { found: false, reason: 'not found' }
          return JSON.stringify(answer)
        }
        const s = m.item
        const { from, to } = yearPeriod(ctx)
        const summary = (await queryClient.fetchQuery(studentAbsencesQuery(ctx.school.id, from, to)))[s.id]
        const last = must(
          await supabase
            .from('attendance_records')
            .select('session_date')
            .eq('student_id', s.id)
            .eq('status', 'absent')
            .gte('session_date', from)
            .lte('session_date', to)
            .order('session_date', { ascending: false })
            .limit(20),
        )
        ids.set(toolCall.id, s.id)
        const answer: Answer = {
          found: true,
          name: fullName(s),
          from,
          to,
          days: summary?.days ?? 0,
          unjustifiedDays: summary?.unjustified_days ?? 0,
          lates: summary?.lates ?? 0,
          // written out, as the assistant will quote them
          lastUnjustified: [...new Set(last.map((r) => r.session_date))]
            .slice(0, 5)
            .map((d) => formatDate(d, locale, { weekday: 'long', day: 'numeric', month: 'long' })),
        }
        return JSON.stringify(answer)
      },
      render: (props) => <AbsencesCard status={props.status} result={props.result} studentId={ids.get(props.toolCallId)} />,
    },
    [ctx.school.id, ctx.year?.id, locale],
  )
  return null
}

function AbsencesCard({ status, result, studentId }: { status: string; result?: string; studentId?: string }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  if (status !== 'complete') return <PendingCard label={t('assistant.looking')} />
  const a = parseResult<Answer>(result)
  if (!a?.found) return null
  return (
    <Box sx={{ p: 1.5, borderRadius: 3, border: `1px solid ${tokens.line}`, bgcolor: tokens.card }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{a.name}</Typography>
      <Typography sx={{ fontSize: 12, color: tokens.inkMuted, mb: 1 }}>
        {t('abs.period', { from: formatDate(a.from!, locale), to: formatDate(a.to!, locale) })}
      </Typography>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag label={t('abs.days', { n: a.days ?? 0 })} />
        {(a.unjustifiedDays ?? 0) > 0 && <Tag tone="danger" label={t('abs.unjustified', { n: a.unjustifiedDays ?? 0 })} />}
        {(a.lates ?? 0) > 0 && <Tag tone="warn" label={t('abs.lates', { n: a.lates ?? 0 })} />}
        <Box sx={{ flex: 1 }} />
        {studentId && (
          <Button size="small" onClick={() => setOpen(true)}>
            {t('abs.seeDetail')}
          </Button>
        )}
      </Stack>
      {open && studentId && <StudentAbsencesDialog studentId={studentId} name={a.name!} onClose={() => setOpen(false)} />}
    </Box>
  )
}
