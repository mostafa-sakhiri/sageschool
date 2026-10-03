import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Autocomplete, Box, Button, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { SurfaceActions, SurfaceContent, SurfaceDialog, SurfaceTitle } from '#/components/Surface'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { classesQuery } from '#/features/classes/api'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import type { Announcement } from '#/features/queries'

export type AnnouncementPrefill = { title?: string; body?: string; priority?: Announcement['priority']; classIds?: string[] }

// New announcement, or edit an existing one. A published announcement keeps
// its audience (the parents were already counted and maybe written to): only
// its text and priority change. `prefill` seeds a new one (assistant card);
// `onSaved` runs after any successful save, before `onClose`.
export function AnnouncementForm({
  initial,
  prefill,
  onClose,
  onPublished,
  onSaved,
}: {
  initial: Announcement | null
  prefill?: AnnouncementPrefill
  onClose: () => void
  onPublished: (id: string) => void
  onSaved?: (id: string, published: boolean) => void
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const published = initial?.status === 'published'
  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? prefill?.body ?? '')
  const [priority, setPriority] = useState<Announcement['priority']>(initial?.priority ?? prefill?.priority ?? 'normal')
  const initialScope = prefill?.classIds?.length ? 'classes' : !initial?.targets.length ? 'school' : initial.targets.some((x) => x.class_id) ? 'classes' : 'nodes'
  const [scope, setScope] = useState<'school' | 'classes' | 'nodes'>(initialScope)
  const [classIds, setClassIds] = useState<string[]>(initial?.targets.flatMap((x) => (x.class_id ? [x.class_id] : [])) ?? prefill?.classIds ?? [])
  const [nodeIds, setNodeIds] = useState<string[]>(initial?.targets.flatMap((x) => (x.node_id ? [x.node_id] : [])) ?? [])

  // Any node can be a target: a cycle, a level, a track (descendants included).
  const nodeOptions = useMemo(() => (nodes.data ?? []).filter((n) => n.kind !== 'option'), [nodes.data])

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      let id = initial?.id
      if (id) must(await supabase.from('announcements').update({ title, body, priority }).eq('id', id))
      else
        id = must(
          await supabase
            .from('announcements')
            .insert({ school_id: ctx.school.id, author_member_id: ctx.member.id, title, body, priority, status: 'draft' })
            .select('id')
            .single(),
        ).id
      if (!published) {
        if (initial) must(await supabase.from('announcement_targets').delete().eq('announcement_id', id))
        const targets: { school_id: string; announcement_id: string; class_id: string | null; node_id: string | null }[] =
          scope === 'classes'
            ? classIds.map((c) => ({ school_id: ctx.school.id, announcement_id: id!, class_id: c, node_id: null }))
            : scope === 'nodes'
              ? nodeIds.map((n) => ({ school_id: ctx.school.id, announcement_id: id!, class_id: null, node_id: n }))
              : []
        if (targets.length) must(await supabase.from('announcement_targets').insert(targets))
      }
      // Publishing prepares one outbox row per reached parent (WhatsApp send-out)
      if (publish) must(await supabase.rpc('publish_announcement', { p_announcement_id: id }))
      return { id: id!, publish }
    },
    onSuccess: async ({ id, publish }) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onSaved?.(id, publish)
      onClose()
      // Published: straight to sending it on WhatsApp
      if (publish) onPublished(id)
    },
  })
  const targetsOk = scope === 'school' || (scope === 'classes' ? classIds.length > 0 : nodeIds.length > 0)

  return (
    <SurfaceDialog open onClose={onClose} fullWidth maxWidth="sm">
      <SurfaceTitle>{initial ? t('ann.edit') : t('ann.new')}</SurfaceTitle>
      <SurfaceContent>
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
          {published ? (
            <Alert severity="info" icon={false}>
              {t('ann.editPublished')}
            </Alert>
          ) : (
            <>
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
            </>
          )}
          {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
        </Stack>
      </SurfaceContent>
      <SurfaceActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {published ? (
          <Button variant="contained" onClick={() => save.mutate(false)} disabled={!title || !body} loading={save.isPending}>
            {t('common.save')}
          </Button>
        ) : (
          <>
            <Button onClick={() => save.mutate(false)} disabled={!title || !body || !targetsOk} loading={save.isPending && save.variables === false}>
              {t('ann.saveDraft')}
            </Button>
            {ctx.can('announcements.publish') && (
              <Button variant="contained" onClick={() => save.mutate(true)} disabled={!title || !body || !targetsOk} loading={save.isPending && save.variables === true}>
                {t('ann.publish')}
              </Button>
            )}
          </>
        )}
      </SurfaceActions>
    </SurfaceDialog>
  )
}
