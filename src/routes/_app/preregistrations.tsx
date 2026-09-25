import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import PhoneForwardedOutlined from '@mui/icons-material/PhoneForwardedOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, StatCard, Tag } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { addDays, formatDate, formatDateTime, formatPhone, normalizePhone, todayIso } from '#/lib/format'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { AddStudentDialog, type StudentPrefill } from '#/features/students/AddStudentDialog'
import { tokens } from '#/theme/theme'
import { ACTIVE, CHANNELS, FOLLOWUP_EVERY, STATUSES, TONE, followupDue, preregsQuery, type Prereg, type Status } from '#/features/preregistrations/api'

export const Route = createFileRoute('/_app/preregistrations')({
  validateSearch: (s: Record<string, unknown>): { new?: boolean } => ({ new: s.new === true || s.new === 1 || s.new === '1' || undefined }),
  component: PreregistrationsPage,
})

function PreregistrationsPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const list = useQuery(preregsQuery(ctx.school.id))
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const [filter, setFilter] = useState<'active' | 'due' | 'enrolled' | 'dropped'>('active')
  const [editing, setEditing] = useState<Partial<Prereg> | null>(null)
  const [following, setFollowing] = useState<Prereg | null>(null)
  const [enrolling, setEnrolling] = useState<Prereg | null>(null)
  const search = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  const navigate = useNavigate()
  useEffect(() => {
    if (!search.new) return
    setEditing({})
    navigateSelf({ search: {}, replace: true })
  }, [search.new, navigateSelf])

  const all = list.data ?? []
  const rows = all.filter((p) =>
    filter === 'active' ? ACTIVE.includes(p.status) : filter === 'due' ? followupDue(p) : p.status === filter,
  )
  const due = all.filter((p) => followupDue(p)).length
  const level = (id: string | null) => {
    const n = nodes.data?.find((x) => x.id === id)
    return n ? nodeLabel(n, nodes.data ?? [], locale) : '—'
  }
  const prefill: StudentPrefill | undefined = useMemo(
    () =>
      enrolling
        ? { first: enrolling.child_first_name, last: enrolling.child_last_name, birth: enrolling.birth_date ?? undefined, preinscriptionId: enrolling.id }
        : undefined,
    [enrolling],
  )

  return (
    <AppShell title={t('nav.preregistrations')}>
      <PageIntro
        title={t('prereg.title')}
        subtitle={t('prereg.subtitle')}
        actions={
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setEditing({})}>
            {t('prereg.new')}
          </Button>
        }
      />
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', mb: 2.5 }}>
        <StatCard value={all.filter((p) => ACTIVE.includes(p.status)).length} label={t('prereg.inProgress')} />
        <StatCard value={due} label={t('prereg.due')} />
        <StatCard value={all.filter((p) => p.status === 'visit_planned').length} label={t('prereg.status.visit_planned')} />
        <StatCard value={all.filter((p) => p.status === 'enrolled').length} label={t('prereg.status.enrolled')} />
      </Stack>
      <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ mb: 2 }}>
        <ToggleButton value="active">{t('prereg.inProgress')}</ToggleButton>
        <ToggleButton value="due">
          {t('prereg.due')} ({due})
        </ToggleButton>
        <ToggleButton value="enrolled">{t('prereg.status.enrolled')}</ToggleButton>
        <ToggleButton value="dropped">{t('prereg.status.dropped')}</ToggleButton>
      </ToggleButtonGroup>
      <QueryState
        query={list}
        rows={5}
        empty={(d) =>
          d.length === 0 ? (
            <EmptyState
              title={t('prereg.empty')}
              hint={t('prereg.emptyHint')}
              action={
                <Button variant="contained" onClick={() => setEditing({})}>
                  {t('prereg.new')}
                </Button>
              }
            />
          ) : null
        }
      >
        {() =>
          rows.length === 0 ? (
            <EmptyState title={t('prereg.noneHere')} />
          ) : (
            <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('prereg.child')}</TableCell>
                    <TableCell>{t('prereg.level')}</TableCell>
                    <TableCell>{t('prereg.parent')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell>{t('prereg.lastFollowup')}</TableCell>
                    <TableCell>{t('prereg.nextFollowup')}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((p) => {
                    const isDue = followupDue(p)
                    return (
                      <TableRow key={p.id} sx={{ bgcolor: isDue ? tokens.warnSoft : undefined }}>
                        <TableCell>
                          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                            {p.child_first_name} {p.child_last_name}
                          </Typography>
                          <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>
                            {t('prereg.since', { date: formatDate(p.created_at, locale) })}
                            {p.source ? ` · ${p.source}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>{level(p.node_id)}</TableCell>
                        <TableCell>
                          <Typography sx={{ fontSize: 14 }}>{p.parent_name}</Typography>
                          <Typography dir="ltr" sx={{ fontSize: 12.5, color: tokens.inkMuted, textAlign: 'start' }}>
                            {[formatPhone(p.parent_phone), p.parent_email].filter(Boolean).join(' · ')}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Tag tone={TONE[p.status]} label={t(`prereg.status.${p.status}`)} />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {p.last_followup_at ? (
                            <>
                              <Typography sx={{ fontSize: 13.5 }}>{formatDateTime(p.last_followup_at, locale)}</Typography>
                              <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>{t('prereg.followupCount', { n: p.followup_count })}</Typography>
                            </>
                          ) : (
                            <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('prereg.never')}</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {ACTIVE.includes(p.status) ? (
                            isDue ? (
                              <Tag tone="warn" label={p.next_followup_on ? formatDate(p.next_followup_on, locale) : t('prereg.now')} />
                            ) : (
                              formatDate(p.next_followup_on, locale)
                            )
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {ACTIVE.includes(p.status) && (
                            <>
                              <Button size="small" variant={isDue ? 'contained' : 'outlined'} startIcon={<PhoneForwardedOutlined />} onClick={() => setFollowing(p)} sx={{ mr: 0.5 }}>
                                {t('prereg.followup')}
                              </Button>
                              <Tooltip title={t('prereg.planVisit')}>
                                <IconButton size="small" aria-label={t('prereg.planVisit')} onClick={() => navigate({ to: '/agenda', search: { preinscription: p.id } })}>
                                  <EventOutlined fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={t('prereg.enroll')}>
                                <IconButton size="small" aria-label={t('prereg.enroll')} onClick={() => setEnrolling(p)}>
                                  <HowToRegOutlined fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          {p.student_id && (
                            <Button component={Link} to="/students" size="small">
                              {t('prereg.seeStudent')}
                            </Button>
                          )}
                          <Tooltip title={t('common.edit')}>
                            <IconButton size="small" aria-label={t('common.edit')} onClick={() => setEditing(p)}>
                              <EditOutlined fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Paper>
          )
        }
      </QueryState>
      {editing && <PreregDialog initial={editing} onClose={() => setEditing(null)} />}
      {following && <FollowupDialog p={following} onClose={() => setFollowing(null)} />}
      <AddStudentDialog open={!!enrolling} onClose={() => setEnrolling(null)} onCreated={() => setEnrolling(null)} prefill={prefill} />
    </AppShell>
  )
}

function PreregDialog({ initial, onClose }: { initial: Partial<Prereg>; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const isEdit = !!initial.id
  const [f, setF] = useState({
    child_first_name: initial.child_first_name ?? '',
    child_last_name: initial.child_last_name ?? '',
    birth_date: initial.birth_date ?? '',
    node_id: initial.node_id ?? '',
    academic_year_id: initial.academic_year_id ?? ctx.years.find((y) => !y.is_current && y.starts_on > todayIso())?.id ?? ctx.year?.id ?? '',
    parent_name: initial.parent_name ?? '',
    parent_phone: initial.parent_phone ?? '',
    parent_email: initial.parent_email ?? '',
    source: initial.source ?? '',
    notes: initial.notes ?? '',
    status: (initial.status ?? 'new') as Status,
    next_followup_on: initial.next_followup_on ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = useMutation({
    mutationFn: async () => {
      const row = {
        child_first_name: f.child_first_name.trim(),
        child_last_name: f.child_last_name.trim(),
        birth_date: f.birth_date || null,
        node_id: f.node_id || null,
        academic_year_id: f.academic_year_id || null,
        parent_name: f.parent_name.trim(),
        parent_phone: normalizePhone(f.parent_phone) || null,
        parent_email: f.parent_email.trim() || null,
        source: f.source.trim() || null,
        notes: f.notes.trim() || null,
        status: f.status,
        next_followup_on: f.next_followup_on || null,
      }
      if (isEdit) must(await supabase.from('preinscriptions').update(row).eq('id', initial.id!))
      else must(await supabase.from('preinscriptions').insert({ ...row, school_id: ctx.school.id, created_by_member_id: ctx.member.id }))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'preinscriptions'] })
      onClose()
    },
  })
  const levels = (nodes.data ?? []).filter((n) => n.kind === 'level' || n.kind === 'cycle')
  const valid = f.child_first_name.trim() && f.child_last_name.trim() && f.parent_name.trim() && (f.parent_phone.trim() || f.parent_email.trim())
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogTitle>{isEdit ? t('prereg.edit') : t('prereg.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="h6">{t('prereg.child')}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('students.firstName')} value={f.child_first_name} onChange={set('child_first_name')} required fullWidth autoFocus />
              <TextField label={t('students.lastName')} value={f.child_last_name} onChange={set('child_last_name')} required fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField type="date" label={t('students.birthDate')} value={f.birth_date} onChange={set('birth_date')} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              <TextField select label={t('prereg.level')} value={f.node_id} onChange={set('node_id')} fullWidth slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value="">—</MenuItem>
                {levels.map((n) => (
                  <MenuItem key={n.id} value={n.id}>
                    {nodeLabel(n, nodes.data ?? [], locale)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label={t('enroll.year')} value={f.academic_year_id} onChange={set('academic_year_id')} sx={{ minWidth: 150 }}>
                {ctx.years.map((y) => (
                  <MenuItem key={y.id} value={y.id}>
                    {y.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Typography variant="h6">{t('prereg.parent')}</Typography>
            <TextField label={t('auth.fullName')} value={f.parent_name} onChange={set('parent_name')} required />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('common.phone')} type="tel" value={f.parent_phone} onChange={set('parent_phone')} fullWidth slotProps={{ htmlInput: { dir: 'ltr' } }} />
              <TextField label={t('auth.email')} type="email" value={f.parent_email} onChange={set('parent_email')} fullWidth slotProps={{ htmlInput: { dir: 'ltr' } }} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t('prereg.contactRule')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('prereg.source')} value={f.source} onChange={set('source')} placeholder={t('prereg.sourcePlaceholder')} fullWidth />
              <TextField type="date" label={t('prereg.nextFollowup')} value={f.next_followup_on} onChange={set('next_followup_on')} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            </Stack>
            {isEdit && (
              <TextField select label={t('common.status')} value={f.status} onChange={set('status')}>
                {STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`prereg.status.${s}`)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField label={t('agenda.notes')} value={f.notes} onChange={set('notes')} multiline minRows={2} />
            {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={!valid}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// A follow-up (relance): logged with its channel and note; the database sets
// the last follow-up date and the counter. Optionally plans the next one.
function FollowupDialog({ p, onClose }: { p: Prereg; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('phone')
  const [note, setNote] = useState('')
  const [next, setNext] = useState(addDays(todayIso(), FOLLOWUP_EVERY))
  const [status, setStatus] = useState<Status>(p.status === 'new' ? 'contacted' : p.status)
  const history = useQuery({
    queryKey: ['school', ctx.school.id, 'preinscription-followups', p.id],
    queryFn: async () =>
      must(
        await supabase
          .from('preinscription_followups')
          .select('id, channel, note, created_at, by:school_members(user:users(full_name))')
          .eq('preinscription_id', p.id)
          .order('created_at', { ascending: false }),
      ) as unknown as { id: string; channel: string; note: string | null; created_at: string; by: { user: { full_name: string } | null } | null }[],
  })
  const save = useMutation({
    mutationFn: async () => {
      must(await supabase.from('preinscription_followups').insert({ school_id: ctx.school.id, preinscription_id: p.id, channel, note: note.trim() || null }))
      must(await supabase.from('preinscriptions').update({ next_followup_on: next || null, status }).eq('id', p.id))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t('prereg.followupTitle', { name: `${p.child_first_name} ${p.child_last_name}` })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>
            {p.parent_name}
            {p.parent_phone && (
              <Box component="a" href={`tel:${p.parent_phone}`} dir="ltr" sx={{ ml: 1, color: tokens.accentDark, fontWeight: 600 }}>
                {formatPhone(p.parent_phone)}
              </Box>
            )}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label={t('prereg.channelLabel')} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} fullWidth>
              {CHANNELS.map((c) => (
                <MenuItem key={c} value={c}>
                  {t(`prereg.channel.${c}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as Status)} fullWidth>
              {STATUSES.filter((s) => s !== 'enrolled').map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`prereg.status.${s}`)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField label={t('prereg.followupNote')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} placeholder={t('prereg.followupNotePlaceholder')} />
          <TextField type="date" label={t('prereg.nextFollowup')} value={next} onChange={(e) => setNext(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} helperText={t('prereg.nextHint')} />
          {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
          <Typography variant="h6">{t('prereg.history')}</Typography>
          {(history.data ?? []).length === 0 && <Typography color="text.secondary">{t('prereg.never')}</Typography>}
          <Stack spacing={1}>
            {(history.data ?? []).map((h) => (
              <Box key={h.id} sx={{ borderInlineStart: `3px solid ${tokens.line}`, pl: 1.25 }}>
                <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>
                  {formatDateTime(h.created_at, locale)} · {t(`prereg.channel.${h.channel}`)} · {h.by?.user?.full_name}
                </Typography>
                {h.note && <Typography sx={{ fontSize: 14 }}>{h.note}</Typography>}
              </Box>
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending}>
          {t('prereg.saveFollowup')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
