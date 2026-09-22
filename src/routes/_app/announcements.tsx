import { useMemo, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDateTime } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { tokens } from '#/theme/theme'
import { announcementsQuery, type Announcement } from '#/features/queries'



export const Route = createFileRoute('/_app/announcements')({
  // ?new=1 opens the creation dialog (header quick actions)
  validateSearch: (s: Record<string, unknown>): { new?: boolean } => ({ new: s.new === true || s.new === 1 || s.new === '1' || undefined }),
  loader: ({ context }) => context.schoolId && context.queryClient.prefetchQuery(announcementsQuery(context.schoolId)),
  component: AnnouncementsPage,
})

function AnnouncementsPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const list = useQuery(announcementsQuery(ctx.school.id))
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year && ctx.isOffice })
  const reach = useQuery({
    queryKey: ['school', ctx.school.id, 'outbox-reach'],
    enabled: ctx.isOffice,
    queryFn: async () => {
      const rows = must(
        await supabase.from('notification_outbox').select('ref_id').eq('school_id', ctx.school.id).eq('kind', 'announcement'),
      )
      const m: Record<string, number> = {}
      for (const r of rows) if (r.ref_id) m[r.ref_id] = (m[r.ref_id] ?? 0) + 1
      return m
    },
  })
  const [open, setOpen] = useState(false)
  const { new: openNew } = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  useEffect(() => {
    if (!openNew) return
    setOpen(true)
    navigateSelf({ search: {}, replace: true })
  }, [openNew, navigateSelf])

  const targetLabel = (a: Announcement) => {
    if (!a.targets.length) return [t('ann.wholeSchool')]
    return a.targets.map((tg) =>
      tg.class_id
        ? (classes.data?.find((c) => c.id === tg.class_id)?.name ?? t('ann.aClass'))
        : (() => {
            const n = nodes.data?.find((x) => x.id === tg.node_id)
            return n ? nodeLabel(n, nodes.data ?? [], locale) : t('ann.aLevel')
          })(),
    )
  }

  return (
    <AppShell title={t('nav.announcements')}>
      <PageIntro
        title={t('ann.title')}
        subtitle={ctx.isOffice ? t('ann.subtitleOffice') : t('ann.subtitleReader')}
        actions={
          ctx.isOffice && (
            <Button variant="contained" startIcon={<CampaignOutlined />} onClick={() => setOpen(true)}>
              {t('ann.new')}
            </Button>
          )
        }
      />
      <QueryState
        query={list}
        rows={4}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('ann.empty')} hint={ctx.isOffice ? t('ann.emptyHint') : undefined} /> : null)}
      >
        {(rows) => (
          <Stack spacing={1.5}>
            {rows.map((a) => (
              <Paper key={a.id} variant="outlined" sx={{ p: 2.25, borderColor: a.priority === 'urgent' ? tokens.warnLine : tokens.lineSoft }}>
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.75 }}>
                  <Typography variant="h5" dir="auto" sx={{ flex: 1, minWidth: 200 }}>
                    {a.title}
                  </Typography>
                  {a.priority !== 'normal' && <Tag tone={a.priority === 'urgent' ? 'danger' : 'warn'} label={t(`ann.priority.${a.priority}`)} />}
                  {a.status === 'draft' && <Tag label={t('ann.draft')} />}
                  <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>
                    {formatDateTime(a.published_at ?? a.created_at, locale)}
                  </Typography>
                </Stack>
                <Typography dir="auto" sx={{ whiteSpace: 'pre-wrap', color: tokens.inkSoft, fontSize: 14.5 }}>{a.body}</Typography>
                {ctx.isOffice && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
                    {targetLabel(a).map((l, i) => (
                      <Chip key={i} size="small" label={l} variant="outlined" />
                    ))}
                    {a.status === 'published' && (
                      <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>
                        {t('ann.reached', { n: reach.data?.[a.id] ?? 0 })}
                      </Typography>
                    )}
                    {a.status === 'draft' && <PublishButton id={a.id} />}
                  </Stack>
                )}
              </Paper>
            ))}
          </Stack>
        )}
      </QueryState>
      {open && <NewAnnouncement onClose={() => setOpen(false)} />}
    </AppShell>
  )
}

function PublishButton({ id }: { id: string }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const publish = useMutation({
    mutationFn: async () => must(await supabase.rpc('publish_announcement', { p_announcement_id: id })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] }),
  })
  return (
    <Button size="small" variant="contained" onClick={() => publish.mutate()} loading={publish.isPending} sx={{ marginInlineStart: 'auto' }}>
      {t('ann.publish')}
    </Button>
  )
}

function NewAnnouncement({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<Announcement['priority']>('normal')
  const [scope, setScope] = useState<'school' | 'classes' | 'nodes'>('school')
  const [classIds, setClassIds] = useState<string[]>([])
  const [nodeIds, setNodeIds] = useState<string[]>([])

  // Any node can be a target: a cycle, a level, a track (descendants included).
  const nodeOptions = useMemo(() => (nodes.data ?? []).filter((n) => n.kind !== 'option'), [nodes.data])

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const a = must(
        await supabase
          .from('announcements')
          .insert({ school_id: ctx.school.id, author_member_id: ctx.member.id, title, body, priority, status: 'draft' })
          .select('id')
          .single(),
      )
      const targets: { school_id: string; announcement_id: string; class_id: string | null; node_id: string | null }[] =
        scope === 'classes'
          ? classIds.map((id) => ({ school_id: ctx.school.id, announcement_id: a.id, class_id: id, node_id: null }))
          : scope === 'nodes'
            ? nodeIds.map((id) => ({ school_id: ctx.school.id, announcement_id: a.id, class_id: null, node_id: id }))
            : []
      if (targets.length) must(await supabase.from('announcement_targets').insert(targets))
      // Publishing stubs one WhatsApp message per reached parent (outbox).
      if (publish) return must(await supabase.rpc('publish_announcement', { p_announcement_id: a.id })) as number
      return null
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
    },
  })
  const targetsOk = scope === 'school' || (scope === 'classes' ? classIds.length > 0 : nodeIds.length > 0)

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('ann.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('ann.titleField')} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          <TextField label={t('ann.body')} value={body} onChange={(e) => setBody(e.target.value)} multiline minRows={4} required />
          <TextField select label={t('ann.priorityLabel')} value={priority} onChange={(e) => setPriority(e.target.value as Announcement['priority'])}>
            {(['normal', 'important', 'urgent'] as const).map((p) => (
              <MenuItem key={p} value={p}>
                {t(`ann.priority.${p}`)}
              </MenuItem>
            ))}
          </TextField>
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>
              {t('ann.audience')}
            </Typography>
            <ToggleButtonGroup exclusive size="small" value={scope} onChange={(_, v) => v && setScope(v)}>
              <ToggleButton value="school">{t('ann.wholeSchool')}</ToggleButton>
              <ToggleButton value="nodes">{t('ann.byLevel')}</ToggleButton>
              <ToggleButton value="classes">{t('ann.byClass')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {scope === 'classes' && (
            <Autocomplete
              multiple
              options={classes.data ?? []}
              getOptionLabel={(c) => c.name}
              value={(classes.data ?? []).filter((c) => classIds.includes(c.id))}
              onChange={(_, v) => setClassIds(v.map((c) => c.id))}
              renderInput={(p) => <TextField {...p} label={t('ann.classes')} />}
            />
          )}
          {scope === 'nodes' && (
            <Autocomplete
              multiple
              options={nodeOptions}
              getOptionLabel={(n) => nodeLabel(n, nodes.data ?? [], locale)}
              value={nodeOptions.filter((n) => nodeIds.includes(n.id))}
              onChange={(_, v) => setNodeIds(v.map((n) => n.id))}
              renderInput={(p) => <TextField {...p} label={t('ann.levels')} helperText={t('ann.levelsHint')} />}
            />
          )}
          <Alert severity="info" icon={false}>
            {t('ann.whatsappStub')}
          </Alert>
          {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={() => save.mutate(false)} disabled={!title || !body || !targetsOk} loading={save.isPending && save.variables === false}>
          {t('ann.saveDraft')}
        </Button>
        <Button variant="contained" onClick={() => save.mutate(true)} disabled={!title || !body || !targetsOk} loading={save.isPending && save.variables === true}>
          {t('ann.publish')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
