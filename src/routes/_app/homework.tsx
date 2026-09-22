import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, todayIso } from '#/lib/format'
import { assignmentsQuery, classesQuery } from '#/features/classes/api'
import { subjectsQuery } from '#/features/structure/api'
import { tokens } from '#/theme/theme'
import { homeworkQuery } from '#/features/queries'

export const Route = createFileRoute('/_app/homework')({
  // ?new=1 opens the creation dialog (header quick actions)
  validateSearch: (s: Record<string, unknown>): { new?: boolean } => ({ new: s.new === true || s.new === 1 || s.new === '1' || undefined }), component: HomeworkPage })


function HomeworkPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const list = useQuery(homeworkQuery(ctx.school.id))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const [open, setOpen] = useState(false)
  const { new: openNew } = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  useEffect(() => {
    if (!openNew) return
    setOpen(true)
    navigateSelf({ search: {}, replace: true })
  }, [openNew, navigateSelf])
  const canWrite = ctx.role === 'teacher'
  const today = todayIso()

  return (
    <AppShell title={t('nav.homework')}>
      <PageIntro
        title={t('hw.title')}
        subtitle={canWrite ? t('hw.subtitleTeacher') : t('hw.subtitleReader')}
        actions={
          canWrite && (
            <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setOpen(true)}>
              {t('hw.new')}
            </Button>
          )
        }
      />
      <QueryState query={list} rows={4} empty={(d) => (d.length === 0 ? <EmptyState title={t('hw.empty')} /> : null)}>
        {(rows) => (
          <Stack spacing={1.25}>
            {rows.map((h) => {
              const late = h.due_on && h.due_on < today
              return (
                <Paper key={h.id} variant="outlined" sx={{ p: 2, opacity: late ? 0.7 : 1 }}>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="h5" dir="auto" sx={{ flex: 1, minWidth: 180 }}>
                      {h.title}
                    </Typography>
                    <Tag label={subjects.data?.find((s) => s.id === h.subject_id)?.name ?? '—'} tone="info" />
                    <Tag label={h.class?.name ?? ''} />
                    {h.due_on && (
                      <Typography sx={{ fontSize: 13, color: late ? tokens.inkMuted : tokens.warnInk, fontWeight: 600 }}>
                        {t('hw.due', { date: formatDate(h.due_on, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}
                      </Typography>
                    )}
                  </Stack>
                  <Typography dir="auto" sx={{ mt: 0.75, whiteSpace: 'pre-wrap', color: tokens.inkSoft, fontSize: 14.5 }}>{h.body}</Typography>
                </Paper>
              )
            })}
          </Stack>
        )}
      </QueryState>
      {open && <NewHomework onClose={() => setOpen(false)} />}
    </AppShell>
  )
}

function NewHomework({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const assignments = useQuery({ ...assignmentsQuery(ctx.school.id, classId), enabled: !!classId })
  // Teachers only see the subjects they teach in that class.
  const mySubjects =
    ctx.role === 'teacher'
      ? (subjects.data ?? []).filter((s) => assignments.data?.some((a) => a.subject_id === s.id && a.teacher_member_id === ctx.member.id))
      : (subjects.data ?? [])

  const create = useMutation({
    mutationFn: async () =>
      must(
        await supabase.from('homework').insert({
          school_id: ctx.school.id,
          class_id: classId,
          subject_id: subjectId || null,
          author_member_id: ctx.member.id,
          title: title.trim(),
          body: body.trim(),
          due_on: due || null,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'homework'] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('hw.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label={t('students.class')} value={classId} onChange={(e) => setClassId(e.target.value)} fullWidth required>
              {(classes.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label={t('classes.subject')} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} fullWidth>
              {mySubjects.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField label={t('hw.titleField')} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField label={t('hw.body')} value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={3} required />
          <TextField type="date" label={t('hw.dueOn')} value={due} onChange={(e) => setDue(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => create.mutate()} loading={create.isPending} disabled={!classId || !title.trim() || !body.trim()}>
          {t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
