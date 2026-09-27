import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { SurfaceActions, SurfaceContent, SurfaceDialog, SurfaceTitle } from '#/components/Surface'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { normalizePhone, todayIso } from '#/lib/format'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { STATUSES, type Prereg, type Status } from './api'

// Used by the pre-registrations page and by the assistant (as a card in the
// chat). `onSaved` runs after a successful save, before `onClose`.
export function PreregDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<Prereg> & { appointmentId?: string }
  onClose: () => void
  onSaved?: () => void
}) {
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
      else {
        const p = must(await supabase.from('preinscriptions').insert({ ...row, school_id: ctx.school.id, created_by_member_id: ctx.member.id }).select('id').single())
        // Came from a prospect's visit: link it, and the family is already contacted
        if (initial.appointmentId) {
          must(await supabase.from('appointments').update({ preinscription_id: p.id }).eq('id', initial.appointmentId))
          if (row.status === 'new') must(await supabase.from('preinscriptions').update({ status: 'contacted' }).eq('id', p.id))
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onSaved?.()
      onClose()
    },
  })
  const levels = (nodes.data ?? []).filter((n) => n.kind === 'level' || n.kind === 'cycle')
  const valid = f.child_first_name.trim() && f.child_last_name.trim() && f.parent_name.trim() && (f.parent_phone.trim() || f.parent_email.trim())
  return (
    <SurfaceDialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <SurfaceTitle>{isEdit ? t('prereg.edit') : t('prereg.new')}</SurfaceTitle>
        <SurfaceContent>
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
        </SurfaceContent>
        <SurfaceActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={!valid}>
            {t('common.save')}
          </Button>
        </SurfaceActions>
      </form>
    </SurfaceDialog>
  )
}
