import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import EditOutlined from '@mui/icons-material/EditOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag, fullName } from '#/components/ui'
import { EmptyState, Loading, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDateTime } from '#/lib/format'
import { studentsQuery } from '#/features/students/api'
import { tokens } from '#/theme/theme'
import { CASE_TONE, casesQuery, type CaseRow } from '#/features/queries'


export const Route = createFileRoute('/_app/cases')({
  loader: ({ context }) => context.schoolId && context.queryClient.prefetchQuery(casesQuery(context.schoolId)),
  component: CasesPage,
})

function CasesPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const cases = useQuery(casesQuery(ctx.school.id))
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<'active' | 'resolved'>('active')
  const [composing, setComposing] = useState(false)

  const rows = (cases.data ?? []).filter((c) => (filter === 'resolved' ? c.status === 'resolved' : c.status !== 'resolved'))
  const current = (cases.data ?? []).find((c) => c.id === selected) ?? rows[0]

  return (
    <AppShell title={t('nav.cases')}>
      <PageIntro
        title={ctx.isOffice ? t('cases.titleOffice') : t('cases.titleParent')}
        subtitle={ctx.isOffice ? t('cases.subtitleOffice') : t('cases.subtitleParent')}
        actions={
          ctx.role === 'parent' && (
            <Button variant="contained" startIcon={<EditOutlined />} onClick={() => setComposing(true)}>
              {t('cases.new')}
            </Button>
          )
        }
      />
      <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ mb: 2 }}>
        <ToggleButton value="active">{t('cases.active')}</ToggleButton>
        <ToggleButton value="resolved">{t('cases.resolvedTab')}</ToggleButton>
      </ToggleButtonGroup>
      <QueryState
        query={cases}
        rows={4}
        empty={(d) =>
          d.length === 0 ? <EmptyState title={t('cases.empty')} hint={ctx.role === 'parent' ? t('cases.emptyHintParent') : undefined} /> : null
        }
      >
        {() => (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '340px 1fr' } }}>
            <Paper variant="outlined" sx={{ p: 1, alignSelf: 'start' }}>
              {rows.length === 0 && <Typography sx={{ p: 2, color: tokens.inkMuted }}>{t('cases.noneHere')}</Typography>}
              <List dense>
                {rows.map((c) => (
                  <ListItemButton key={c.id} selected={c.id === current?.id} onClick={() => setSelected(c.id)} sx={{ borderRadius: 2, alignItems: 'flex-start' }}>
                    <ListItemText
                      primary={c.subject}
                      secondary={`${ctx.isOffice ? `${c.parent?.user?.full_name ?? ''} · ` : ''}${formatDateTime(c.updated_at, locale)}`}
                      slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 14 } } }}
                    />
                    <Tag tone={CASE_TONE[c.status]} label={t(`cases.status.${c.status}`)} sx={{ mt: 0.5 }} />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
            {current ? <Thread key={current.id} c={current} /> : <EmptyState title={t('cases.pick')} />}
          </Box>
        )}
      </QueryState>
      {composing && <NewCase onClose={() => setComposing(false)} onCreated={setSelected} />}
    </AppShell>
  )
}

function Thread({ c }: { c: CaseRow }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const messages = useQuery({
    queryKey: ['school', ctx.school.id, 'case-messages', c.id],
    queryFn: async () =>
      must(
        await supabase
          .from('case_messages')
          .select('id, body, created_at, author_member_id, author:school_members(role, user:users(full_name))')
          .eq('case_id', c.id)
          .order('created_at'),
      ) as unknown as { id: string; body: string; created_at: string; author_member_id: string; author: { role: string; user: { full_name: string } | null } | null }[],
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })

  const reply = useMutation({
    mutationFn: async () =>
      must(
        await supabase.from('case_messages').insert({
          school_id: ctx.school.id,
          case_id: c.id,
          author_member_id: ctx.member.id,
          body: body.trim(),
        }),
      ),
    onSuccess: async () => {
      setBody('')
      await invalidate()
    },
  })
  const resolve = useMutation({
    mutationFn: async (reopen: boolean) =>
      must(
        await supabase
          .from('cases')
          .update(
            reopen
              ? { status: 'open', resolved_at: null, resolved_by_member_id: null }
              : { status: 'resolved', resolved_at: new Date().toISOString(), resolved_by_member_id: ctx.member.id },
          )
          .eq('id', c.id),
      ),
    onSuccess: invalidate,
  })

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h4" dir="auto" sx={{ flex: 1 }}>
          {c.subject}
        </Typography>
        <Tag tone={CASE_TONE[c.status]} label={t(`cases.status.${c.status}`)} />
        {ctx.isOffice &&
          (c.status === 'resolved' ? (
            <Button size="small" onClick={() => resolve.mutate(true)} loading={resolve.isPending}>
              {t('cases.reopen')}
            </Button>
          ) : (
            <Button size="small" variant="outlined" onClick={() => resolve.mutate(false)} loading={resolve.isPending}>
              {t('cases.resolve')}
            </Button>
          ))}
      </Stack>
      <Typography sx={{ fontSize: 13, color: tokens.inkMuted, mb: 2 }}>
        {c.parent?.user?.full_name}
        {c.student ? ` · ${fullName(c.student)}` : ''}
      </Typography>
      <Stack spacing={1.25} sx={{ flex: 1, mb: 2 }}>
        {messages.isPending && <Loading rows={2} />}
        {(messages.data ?? []).map((m) => {
          const fromSchool = m.author?.role === 'admin' || m.author?.role === 'staff'
          const mine = m.author_member_id === ctx.member.id
          return (
            <Box
              key={m.id}
              sx={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                p: 1.5,
                borderRadius: 3,
                bgcolor: fromSchool ? tokens.accentSoft : '#F2EEE4',
                border: `1px solid ${fromSchool ? tokens.accentLine : tokens.lineSoft}`,
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: tokens.inkMuted, mb: 0.5 }}>
                {m.author?.user?.full_name} · {fromSchool ? t('cases.school') : t('role.parent')} · {formatDateTime(m.created_at, locale)}
              </Typography>
              <Typography dir="auto" sx={{ whiteSpace: 'pre-wrap', fontSize: 14.5 }}>{m.body}</Typography>
            </Box>
          )
        })}
      </Stack>
      {c.status === 'resolved' ? (
        <Alert severity="success">{t('cases.closed')}</Alert>
      ) : (
        <Stack
          component="form"
          spacing={1}
          onSubmit={(e) => {
            e.preventDefault()
            if (body.trim()) reply.mutate()
          }}
        >
          <TextField
            label={ctx.isOffice ? t('cases.replyAsSchool') : t('cases.reply')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            multiline
            minRows={2}
          />
          {ctx.isOffice && <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{t('cases.whatsappStub')}</Typography>}
          <Box>
            <Button type="submit" variant="contained" loading={reply.isPending} disabled={!body.trim()}>
              {t('cases.send')}
            </Button>
          </Box>
          {(reply.isError || resolve.isError) && <Alert severity="error">{errorMessage(reply.error ?? resolve.error, t)}</Alert>}
        </Stack>
      )}
    </Paper>
  )
}

function NewCase({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const kids = useQuery(studentsQuery(ctx.school.id))
  const [subject, setSubject] = useState('')
  const [studentId, setStudentId] = useState('')
  const [body, setBody] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      const c = must(
        await supabase
          .from('cases')
          .insert({
            school_id: ctx.school.id,
            direction: 'parent_to_school',
            subject: subject.trim(),
            student_id: studentId || null,
            parent_member_id: ctx.member.id,
            opened_by_member_id: ctx.member.id,
          })
          .select('id')
          .single(),
      )
      must(
        await supabase.from('case_messages').insert({
          school_id: ctx.school.id,
          case_id: c.id,
          author_member_id: ctx.member.id,
          body: body.trim(),
        }),
      )
      return c.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'cases'] })
      onCreated(id)
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('cases.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('cases.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus />
          <TextField select label={t('cases.aboutChild')} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <MenuItem value="">{t('cases.noChild')}</MenuItem>
            {(kids.data ?? []).map((k) => (
              <MenuItem key={k.id} value={k.id}>
                {fullName(k)}
              </MenuItem>
            ))}
          </TextField>
          <TextField label={t('cases.message')} value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={4} required />
          {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => create.mutate()} loading={create.isPending} disabled={!subject.trim() || !body.trim()}>
          {t('cases.send')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
