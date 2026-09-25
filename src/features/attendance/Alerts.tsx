import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import AddAlertOutlined from '@mui/icons-material/AddAlertOutlined'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import { Tag, fullName } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, formatDateTime, formatPhone } from '#/lib/format'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
import { tokens } from '#/theme/theme'
import { alertsQuery, type StudentAlert } from './api'

// Alerts about a student: created automatically after 3 school days of absence
// in a row (database trigger), or by hand. The office calls the family and
// marks the parent as notified (green); then closes the alert.
export function AlertsPanel() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const alerts = useQuery(alertsQuery(ctx.school.id))
  const students = useQuery(studentsQuery(ctx.school.id))
  const [filter, setFilter] = useState<'open' | 'notified' | 'closed'>('open')
  const [creating, setCreating] = useState(false)

  const update = useMutation({
    mutationFn: async ({ a, status }: { a: StudentAlert; status: StudentAlert['status'] }) =>
      must(
        await supabase
          .from('student_alerts')
          .update(
            status === 'notified'
              ? { status, notified_at: new Date().toISOString(), notified_by_member_id: ctx.member.id }
              : status === 'open'
                ? { status, notified_at: null, notified_by_member_id: null }
                : { status },
          )
          .eq('id', a.id),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'alerts'] }),
  })

  const student = (id: string) => students.data?.find((s) => s.id === id)
  const counts = { open: 0, notified: 0, closed: 0 }
  for (const a of alerts.data ?? []) counts[a.status]++
  const rows = (alerts.data ?? []).filter((a) => a.status === filter)

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)}>
          <ToggleButton value="open">{t('alerts.toNotify')} ({counts.open})</ToggleButton>
          <ToggleButton value="notified">{t('alerts.notified')} ({counts.notified})</ToggleButton>
          <ToggleButton value="closed">{t('alerts.closed')}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" startIcon={<AddAlertOutlined />} onClick={() => setCreating(true)}>
          {t('alerts.new')}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('alerts.hint')}
      </Typography>
      {update.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(update.error, t)}</Alert>}
      <QueryState query={alerts} rows={3}>
        {() =>
          rows.length === 0 ? (
            <EmptyState title={filter === 'open' ? t('alerts.noneOpen') : t('alerts.none')} />
          ) : (
            <Stack spacing={1}>
              {rows.map((a) => {
                const s = student(a.student_id)
                const cls = s ? currentEnrollment(s, ctx.year?.id)?.class?.name : undefined
                const notified = a.status === 'notified'
                return (
                  <Paper
                    key={a.id}
                    variant="outlined"
                    sx={{
                      p: 2,
                      display: 'flex',
                      gap: 2,
                      flexWrap: { xs: 'wrap', md: 'nowrap' },
                      alignItems: 'center',
                      borderColor: a.status === 'open' ? tokens.dangerLine : notified ? tokens.accentLine : tokens.line,
                      bgcolor: a.status === 'open' ? tokens.dangerSoft : notified ? tokens.accentSoft : tokens.card,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography sx={{ fontWeight: 600 }}>{s ? fullName(s) : '—'}</Typography>
                        {cls && <Typography sx={{ color: tokens.inkMuted, fontSize: 13 }}>· {cls}</Typography>}
                        {notified ? (
                          <Tag tone="ok" label={t('alerts.parentNotified')} icon={<CheckCircleOutlined sx={{ fontSize: 14 }} />} />
                        ) : a.status === 'open' ? (
                          <Tag tone="danger" label={t('alerts.toNotify')} />
                        ) : (
                          <Tag label={t('alerts.closed')} />
                        )}
                      </Stack>
                      <Typography sx={{ fontSize: 14, mt: 0.25 }}>
                        {a.kind === 'absence_streak'
                          ? t('alerts.streak', { n: a.days ?? 0, from: formatDate(a.starts_on, locale), to: formatDate(a.ends_on, locale) })
                          : a.title}
                      </Typography>
                      {a.note && <Typography sx={{ fontSize: 13, color: tokens.inkSoft }}>{a.note}</Typography>}
                      <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, mt: 0.5 }}>
                        {(s?.guardians ?? []).length
                          ? s!.guardians.map((g) => [g.member?.user?.full_name, formatPhone(g.member?.user?.phone)].filter(Boolean).join(' ')).join(' · ')
                          : t('students.noParent')}
                      </Typography>
                      {notified && (
                        <Typography sx={{ fontSize: 12.5, color: tokens.accentDark }}>
                          {t('alerts.notifiedBy', { name: a.notified_by?.user?.full_name ?? '', at: formatDateTime(a.notified_at, locale) })}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                      {a.status === 'open' && (
                        <Button variant="contained" size="small" startIcon={<CheckCircleOutlined />} onClick={() => update.mutate({ a, status: 'notified' })}>
                          {t('alerts.markNotified')}
                        </Button>
                      )}
                      {a.status !== 'closed' ? (
                        <Button size="small" onClick={() => update.mutate({ a, status: 'closed' })}>
                          {t('alerts.close')}
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => update.mutate({ a, status: 'open' })}>
                          {t('alerts.reopen')}
                        </Button>
                      )}
                      {notified && (
                        <Button size="small" onClick={() => update.mutate({ a, status: 'open' })}>
                          {t('alerts.undoNotified')}
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          )
        }
      </QueryState>
      {creating && <NewAlert onClose={() => setCreating(false)} />}
    </>
  )
}

function NewAlert({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const students = useQuery(studentsQuery(ctx.school.id))
  const [studentId, setStudentId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const create = useMutation({
    mutationFn: async () =>
      must(
        await supabase.from('student_alerts').insert({
          school_id: ctx.school.id,
          student_id: studentId!,
          kind: 'manual',
          title: title.trim(),
          note: note.trim() || null,
          created_by_member_id: ctx.member.id,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'alerts'] })
      onClose()
    },
  })
  const options = students.data ?? []
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('alerts.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Autocomplete
            options={options}
            value={options.find((s) => s.id === studentId) ?? null}
            onChange={(_, v) => setStudentId(v?.id ?? null)}
            getOptionLabel={(s) => `${fullName(s)}${currentEnrollment(s, ctx.year?.id)?.class?.name ? ` · ${currentEnrollment(s, ctx.year?.id)!.class!.name}` : ''}`}
            renderInput={(params) => <TextField {...params} label={t('students.student')} required autoFocus />}
          />
          <TextField label={t('alerts.what')} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={t('alerts.whatPlaceholder')} />
          <TextField label={t('alerts.note')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
          {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => create.mutate()} loading={create.isPending} disabled={!studentId || !title.trim()}>
          {t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
