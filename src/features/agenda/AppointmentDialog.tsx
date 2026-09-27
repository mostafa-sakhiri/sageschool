import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Autocomplete, Button, MenuItem, Stack, TextField } from '@mui/material'
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined'
import { fullName } from '#/components/ui'
import { SurfaceActions, SurfaceContent, SurfaceDialog, SurfaceTitle } from '#/components/Surface'
import { WhatsAppButton } from '#/components/WhatsApp'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, normalizePhone, todayIso } from '#/lib/format'
import { studentsQuery } from '#/features/students/api'
import { membersQuery } from '#/features/team/api'

export const KINDS = ['visit_parent', 'visit_student', 'visit_prospect', 'enrollment', 'meeting', 'other'] as const
export type Kind = (typeof KINDS)[number]
export const STATUSES = ['planned', 'done', 'no_show', 'cancelled'] as const
export type Status = (typeof STATUSES)[number]

export type Appointment = {
  id: string
  kind: Kind
  title: string
  starts_at: string
  ends_at: string
  visitor_name: string | null
  visitor_phone: string | null
  student_id: string | null
  preinscription_id: string | null
  host_member_id: string | null
  notes: string | null
  status: Status
}

export const pad = (n: number) => String(n).padStart(2, '0')
export const localDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const localTime = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const toIso = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString()
export const plusMinutes = (time: string, n: number) => {
  const [h, m] = time.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, h * 60 + m + n)
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
}

// Used by the agenda page and by the assistant (as a card in the chat).
// `onSaved` runs after a successful save, before `onClose`.
export function AppointmentDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<Appointment>
  onClose: () => void
  onSaved?: () => void
}) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const students = useQuery(studentsQuery(ctx.school.id))
  const members = useQuery(membersQuery(ctx.school.id))
  const hosts = (members.data ?? []).filter((m) => (m.role === 'admin' || m.role === 'staff') && m.status === 'active')
  const now = new Date()
  const defaultStart = `${pad(Math.min(17, Math.max(8, now.getHours() + 1)))}:00`
  const [kind, setKind] = useState<Kind>(initial.kind ?? 'visit_parent')
  const [title, setTitle] = useState(initial.title ?? '')
  const [date, setDate] = useState(initial.starts_at ? localDate(initial.starts_at) : todayIso())
  const [startTime, setStartTime] = useState(initial.starts_at ? localTime(initial.starts_at) : defaultStart)
  const [endTime, setEndTime] = useState(initial.ends_at ? localTime(initial.ends_at) : plusMinutes(defaultStart, 30))
  const [visitor, setVisitor] = useState(initial.visitor_name ?? '')
  const [phone, setPhone] = useState(initial.visitor_phone ?? '')
  const [studentId, setStudentId] = useState<string | null>(initial.student_id ?? null)
  const [hostId, setHostId] = useState(initial.host_member_id ?? (ctx.isAdmin ? ctx.member.id : ''))
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [status, setStatus] = useState<Status>(initial.status ?? 'planned')
  const isEdit = !!initial.id

  // A student picked: the visitor defaults to their first parent
  const pickStudent = (id: string | null) => {
    setStudentId(id)
    const s = students.data?.find((x) => x.id === id)
    const g = s?.guardians[0]?.member?.user
    if (s && g && !visitor) {
      setVisitor(g.full_name)
      setPhone(g.phone ?? '')
    }
    if (s && !title) setTitle(t(`agenda.kind.${kind}`) + ' — ' + fullName(s))
  }

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        kind,
        title: title.trim() || `${t(`agenda.kind.${kind}`)}${visitor ? ` — ${visitor}` : ''}`,
        starts_at: toIso(date, startTime),
        ends_at: toIso(date, endTime),
        visitor_name: visitor.trim() || null,
        visitor_phone: normalizePhone(phone) || null,
        student_id: kind === 'visit_prospect' ? null : studentId,
        host_member_id: hostId || null,
        notes: notes.trim() || null,
        status,
      }
      if (isEdit) must(await supabase.from('appointments').update(row).eq('id', initial.id!))
      else {
        must(
          await supabase
            .from('appointments')
            .insert({ ...row, school_id: ctx.school.id, preinscription_id: initial.preinscription_id ?? null, created_by_member_id: ctx.member.id }),
        )
        if (initial.preinscription_id)
          must(await supabase.from('preinscriptions').update({ status: 'visit_planned' }).eq('id', initial.preinscription_id).in('status', ['new', 'contacted', 'waiting']))
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onSaved?.()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('appointments').delete().eq('id', initial.id!)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'appointments'] })
      onClose()
    },
  })
  const invalidTime = endTime <= startTime

  return (
    <SurfaceDialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <SurfaceTitle>{isEdit ? t('agenda.edit') : t('agenda.new')}</SurfaceTitle>
        <SurfaceContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label={t('agenda.kindLabel')} value={kind} onChange={(e) => setKind(e.target.value as Kind)} sx={{ minWidth: 200 }}>
                {KINDS.map((k) => (
                  <MenuItem key={k} value={k}>
                    {t(`agenda.kind.${k}`)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label={t('agenda.titleLabel')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth placeholder={t('agenda.titlePlaceholder')} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField type="date" label={t('common.date')} value={date} onChange={(e) => setDate(e.target.value)} required slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              <TextField
                type="time"
                label={t('agenda.from')}
                value={startTime}
                onChange={(e) => {
                  const v = e.target.value
                  setStartTime(v)
                  if (endTime <= v) setEndTime(plusMinutes(v, 30))
                }}
                required
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField type="time" label={t('agenda.to')} value={endTime} onChange={(e) => setEndTime(e.target.value)} required error={invalidTime} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
            </Stack>
            {kind === 'visit_prospect' ? (
              <Alert severity="info" icon={false}>
                {t('agenda.prospectHint')}
              </Alert>
            ) : (
            <Autocomplete
              options={students.data ?? []}
              value={(students.data ?? []).find((s) => s.id === studentId) ?? null}
              onChange={(_, v) => pickStudent(v?.id ?? null)}
              getOptionLabel={(s) => fullName(s)}
              renderInput={(params) => <TextField {...params} label={t('agenda.student')} helperText={t('agenda.studentHint')} />}
            />
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <TextField label={t('agenda.visitor')} value={visitor} onChange={(e) => setVisitor(e.target.value)} fullWidth />
              <TextField label={t('common.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} fullWidth slotProps={{ htmlInput: { dir: 'ltr' } }} />
              <WhatsAppButton
                phone={phone}
                tooltip={t('wa.appointmentTooltip')}
                text={t('wa.appointment', { name: visitor, date: formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' }), time: startTime, school: ctx.school.name })}
              />
            </Stack>
            <TextField select label={t('agenda.host')} value={hostId} onChange={(e) => setHostId(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
              <MenuItem value="">—</MenuItem>
              {hosts.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.user?.full_name} · {t(`role.${m.role}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField label={t('agenda.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
            {isEdit && (
              <TextField select label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`agenda.status.${s}`)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {invalidTime && <Alert severity="warning">{t('agenda.badTime')}</Alert>}
            {(save.isError || remove.isError) && <Alert severity="error">{errorMessage(save.error ?? remove.error, t)}</Alert>}
          </Stack>
        </SurfaceContent>
        <SurfaceActions>
          {isEdit && (
            <Button color="error" onClick={() => remove.mutate()} loading={remove.isPending} sx={{ mr: 'auto' }}>
              {t('common.delete')}
            </Button>
          )}
          {isEdit && kind === 'visit_prospect' && !initial.preinscription_id && (
            <Button
              startIcon={<HowToRegOutlined />}
              onClick={() => navigate({ to: '/preregistrations', search: { new: true, parent: visitor || undefined, phone: phone || undefined, appointment: initial.id } })}
            >
              {t('agenda.toPrereg')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={invalidTime || !date}>
            {t('common.save')}
          </Button>
        </SurfaceActions>
      </form>
    </SurfaceDialog>
  )
}
