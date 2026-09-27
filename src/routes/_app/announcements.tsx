import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { WhatsAppBroadcast } from '#/features/announcements/WhatsAppBroadcast'
import { AnnouncementForm } from '#/features/announcements/AnnouncementForm'
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

type Reach = Record<string, { total: number; sent: number }>
const TABS = ['toSend', 'sent', 'drafts'] as const
type AnnTab = (typeof TABS)[number]

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
        await supabase.from('notification_outbox').select('ref_id, status').eq('school_id', ctx.school.id).eq('kind', 'announcement'),
      )
      const m: Reach = {}
      for (const r of rows)
        if (r.ref_id) {
          m[r.ref_id] ??= { total: 0, sent: 0 }
          m[r.ref_id].total++
          if (r.status === 'sent') m[r.ref_id].sent++
        }
      return m
    },
  })
  // One dialog at a time: the form (new or edit), the detail, the WhatsApp
  // send-out, or the delete confirmation
  const [form, setForm] = useState<Announcement | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [broadcastId, setBroadcastId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Announcement | null>(null)
  const byId = (id: string | null) => (list.data ?? []).find((a) => a.id === id)
  const { new: openNew } = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  useEffect(() => {
    if (!openNew) return
    setForm('new')
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
  const detail = byId(openId)
  const broadcast = byId(broadcastId)

  // Office tabs: published but not yet sent to every parent (1/x), sent to
  // all (x/x, or nobody to reach), drafts
  const tabOf = (a: Announcement): AnnTab => {
    if (a.status === 'draft') return 'drafts'
    const r = reach.data?.[a.id]
    return r && r.sent < r.total ? 'toSend' : 'sent'
  }
  const counts = { toSend: 0, sent: 0, drafts: 0 }
  for (const a of list.data ?? []) counts[tabOf(a)]++
  const [chosenTab, setTab] = useState<AnnTab | null>(null)
  const tab: AnnTab = chosenTab ?? (counts.toSend ? 'toSend' : counts.drafts && !counts.sent ? 'drafts' : 'sent')

  return (
    <AppShell title={t('nav.announcements')}>
      <PageIntro
        title={t('ann.title')}
        subtitle={ctx.isOffice ? t('ann.subtitleOffice') : t('ann.subtitleReader')}
        actions={
          ctx.isOffice && (
            <Button variant="contained" startIcon={<CampaignOutlined />} onClick={() => setForm('new')}>
              {t('ann.new')}
            </Button>
          )
        }
      />
      {ctx.isOffice && (list.data ?? []).length > 0 && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: `1px solid ${tokens.line}` }}>
          {TABS.map((k) => (
            <Tab
              key={k}
              value={k}
              label={
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <span>{t(`ann.tab.${k}`)}</span>
                  <Tag tone={k === 'toSend' && counts.toSend ? 'warn' : k === 'sent' && counts.sent ? 'ok' : 'neutral'} label={counts[k]} />
                </Stack>
              }
            />
          ))}
        </Tabs>
      )}
      <QueryState
        query={list}
        rows={4}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('ann.empty')} hint={ctx.isOffice ? t('ann.emptyHint') : undefined} /> : null)}
      >
        {(all) => {
          const rows = ctx.isOffice ? all.filter((a) => tabOf(a) === tab) : all
          if (rows.length === 0) return <EmptyState title={t(`ann.tabEmpty.${tab}`)} />
          return (
          <Stack spacing={1.5}>
            {rows.map((a) => (
              <Paper
                key={a.id}
                variant="outlined"
                role="button"
                tabIndex={0}
                aria-label={t('ann.open', { title: a.title })}
                onClick={() => setOpenId(a.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenId(a.id)
                  }
                }}
                sx={{
                  p: 2.25,
                  cursor: 'pointer',
                  borderColor: a.priority === 'urgent' ? tokens.dangerLine : a.priority === 'important' ? tokens.warnLine : tokens.line,
                  transition: 'border-color 120ms, box-shadow 120ms, background-color 120ms',
                  '&:hover': { borderColor: tokens.lineStrong, bgcolor: tokens.cardWarm, boxShadow: tokens.shadowSm },
                  '&:hover .ann-actions': { opacity: 1 },
                  '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 2 },
                }}
              >
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.75 }}>
                  <Typography variant="h5" dir="auto" sx={{ flex: 1, minWidth: 200 }}>
                    {a.title}
                  </Typography>
                  {a.priority !== 'normal' && <Tag tone={a.priority === 'urgent' ? 'danger' : 'warn'} label={t(`ann.priority.${a.priority}`)} />}
                  {a.status === 'draft' && <Tag label={t('ann.draft')} />}
                  <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{formatDateTime(a.published_at ?? a.created_at, locale)}</Typography>
                  {ctx.isOffice && (
                    <Stack direction="row" className="ann-actions" sx={{ opacity: { xs: 1, md: 0.55 }, transition: 'opacity 120ms' }}>
                      <Tooltip title={t('common.edit')}>
                        <IconButton
                          size="small"
                          aria-label={`${t('common.edit')} — ${a.title}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setForm(a)
                          }}
                        >
                          <EditOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <IconButton
                          size="small"
                          aria-label={`${t('common.delete')} — ${a.title}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleting(a)
                          }}
                          sx={{ '&:hover': { color: tokens.dangerInk, bgcolor: tokens.dangerSoft } }}
                        >
                          <DeleteOutlineOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )}
                </Stack>
                <Typography
                  dir="auto"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    color: tokens.inkSoft,
                    fontSize: 14.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {a.body}
                </Typography>
                {ctx.isOffice && (
                  <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
                    {targetLabel(a).map((l, i) => (
                      <Chip key={i} size="small" label={l} variant="outlined" />
                    ))}
                    {a.status === 'published' && (
                      <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{t('ann.reached', { n: reach.data?.[a.id]?.total ?? 0 })}</Typography>
                    )}
                    <Box sx={{ marginInlineStart: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      {a.status === 'published' ? (
                        <Button size="small" variant="outlined" startIcon={<WhatsAppIcon sx={{ color: '#25D366' }} />} onClick={() => setBroadcastId(a.id)}>
                          {t('bc.button', { sent: reach.data?.[a.id]?.sent ?? 0, total: reach.data?.[a.id]?.total ?? 0 })}
                        </Button>
                      ) : (
                        <PublishButton id={a.id} onPublished={setBroadcastId} />
                      )}
                    </Box>
                  </Stack>
                )}
              </Paper>
            ))}
          </Stack>
          )
        }}
      </QueryState>

      {detail && (
        <AnnouncementDetail
          a={detail}
          targets={targetLabel(detail)}
          reach={reach.data?.[detail.id]}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null)
            setForm(detail)
          }}
          onDelete={() => {
            setOpenId(null)
            setDeleting(detail)
          }}
          onBroadcast={() => {
            setOpenId(null)
            setBroadcastId(detail.id)
          }}
        />
      )}
      {form && (
        <AnnouncementForm
          initial={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onPublished={setBroadcastId}
        />
      )}
      {deleting && <DeleteDialog a={deleting} sent={reach.data?.[deleting.id]?.sent ?? 0} onClose={() => setDeleting(null)} />}
      {broadcast && (
        <WhatsAppBroadcast
          announcement={broadcast}
          onClose={() => {
            setBroadcastId(null)
            void reach.refetch()
          }}
        />
      )}
    </AppShell>
  )
}

// The whole announcement, for everyone; the office also gets its actions.
function AnnouncementDetail({
  a,
  targets,
  reach,
  onClose,
  onEdit,
  onDelete,
  onBroadcast,
}: {
  a: Announcement
  targets: string[]
  reach?: { total: number; sent: number }
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onBroadcast: () => void
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography dir="auto" sx={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {a.title}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.75 }}>
            {a.priority !== 'normal' && <Tag tone={a.priority === 'urgent' ? 'danger' : 'warn'} label={t(`ann.priority.${a.priority}`)} />}
            <Tag tone={a.status === 'published' ? 'ok' : 'neutral'} label={a.status === 'published' ? t('ann.published') : t('ann.draft')} />
            <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{formatDateTime(a.published_at ?? a.created_at, locale)}</Typography>
          </Stack>
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography dir="auto" sx={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.6 }}>
          {a.body}
        </Typography>
        {ctx.isOffice && (
          <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${tokens.lineSoft}` }}>
            <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, mb: 0.75 }}>{t('ann.audience')}</Typography>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {targets.map((l, i) => (
                <Chip key={i} size="small" label={l} variant="outlined" />
              ))}
            </Stack>
            {a.status === 'published' && reach && (
              <Typography sx={{ fontSize: 13.5, mt: 1.5 }}>{t('ann.whatsappProgress', { sent: reach.sent, total: reach.total })}</Typography>
            )}
          </Box>
        )}
      </DialogContent>
      {ctx.isOffice && (
        <DialogActions>
          <Button color="error" startIcon={<DeleteOutlineOutlined />} onClick={onDelete} sx={{ mr: 'auto' }}>
            {t('common.delete')}
          </Button>
          <Button startIcon={<EditOutlined />} onClick={onEdit}>
            {t('common.edit')}
          </Button>
          {a.status === 'published' ? (
            <Button variant="contained" startIcon={<WhatsAppIcon />} onClick={onBroadcast}>
              {t('ann.sendWhatsApp')}
            </Button>
          ) : (
            <PublishButton
              id={a.id}
              onPublished={() => {
                onBroadcast()
              }}
            />
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}

function DeleteDialog({ a, sent, onClose }: { a: Announcement; sent: number; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('announcements').delete().eq('id', a.id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('ann.deleteTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('ann.deleteText', { title: a.title })}</DialogContentText>
        {a.status === 'published' && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {sent > 0 ? t('ann.deleteSent', { n: sent }) : t('ann.deletePublished')}
          </Alert>
        )}
        {remove.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage(remove.error, t)}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} autoFocus>
          {t('common.cancel')}
        </Button>
        <Button color="error" variant="contained" onClick={() => remove.mutate()} loading={remove.isPending}>
          {t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function PublishButton({ id, onPublished }: { id: string; onPublished: (id: string) => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const publish = useMutation({
    mutationFn: async () => must(await supabase.rpc('publish_announcement', { p_announcement_id: id })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onPublished(id)
    },
  })
  return (
    <Button size="small" variant="contained" onClick={() => publish.mutate()} loading={publish.isPending}>
      {t('ann.publish')}
    </Button>
  )
}

