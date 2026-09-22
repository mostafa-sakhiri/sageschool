import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, hhmm, todayIso } from '#/lib/format'
import { formatMinutes, roomsQuery, subjectsQuery } from '#/features/structure/api'
import { assignmentsQuery, requiredHoursQuery, teachersQuery } from '#/features/classes/api'
import { EmptyState, Loading } from '#/components/states'
import { Tag } from '#/components/ui'
import { WeekGrid, type Block } from './WeekGrid'
import { membersNamesQuery, slotsQuery, subjectColor, versionsQuery, type Slot, type Version } from './api'
import { useSchoolDays } from './RealWeek'
import { tokens } from '#/theme/theme'

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Versioned timetable (schema §7): a draft is edited freely, then published;
// publishing closes the previous version the day before. A published version
// is never edited in place: "Nouvelle version" forks it from a date.
export function Builder({ classId }: { classId: string }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const versions = useQuery(versionsQuery(ctx.school.id, classId))
  const [versionId, setVersionId] = useState<string | null>(null)
  const [forkOpen, setForkOpen] = useState(false)

  useEffect(() => setVersionId(null), [classId])
  const list = versions.data ?? []
  const current = list.find((v) => v.id === versionId) ?? list.find((v) => v.status === 'draft') ?? list[0]

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-versions', classId] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-week'] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-teacher-week'] }),
    ])

  const createFirst = useMutation({
    mutationFn: async () =>
      must(
        await supabase
          .from('timetable_versions')
          .insert({
            school_id: ctx.school.id,
            class_id: classId,
            name: t('tt.firstVersionName', { year: ctx.year?.name ?? '' }),
            effective_from: ctx.year!.starts_on,
            created_by_member_id: ctx.member.id,
          })
          .select('id')
          .single(),
      ),
    onSuccess: async (v) => {
      await invalidate()
      setVersionId(v.id)
    },
  })
  const publish = useMutation({
    mutationFn: async (id: string) => must(await supabase.rpc('publish_timetable_version', { p_version_id: id })),
    onSuccess: invalidate,
  })
  const discard = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('timetable_versions').delete().eq('id', id)),
    onSuccess: async () => {
      setVersionId(null)
      await invalidate()
    },
  })

  if (versions.isPending) return <Loading rows={5} />
  if (!list.length)
    return (
      <EmptyState
        title={t('tt.noVersion')}
        hint={t('tt.noVersionHint')}
        action={
          <Button variant="contained" onClick={() => createFirst.mutate()} loading={createFirst.isPending} disabled={!ctx.year}>
            {t('tt.createFirst')}
          </Button>
        }
      />
    )

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
          <TextField
            select
            label={t('tt.version')}
            value={current?.id ?? ''}
            onChange={(e) => setVersionId(e.target.value)}
            sx={{ minWidth: 320 }}
          >
            {list.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name} · {t(`tt.status.${v.status}`)} · {formatDate(v.effective_from, locale)}
                {v.effective_to ? ` → ${formatDate(v.effective_to, locale)}` : ''}
              </MenuItem>
            ))}
          </TextField>
          {current && <StatusTag v={current} />}
          <Box sx={{ flex: 1 }} />
          {current?.status === 'draft' && (
            <>
              <Button color="error" onClick={() => discard.mutate(current.id)} loading={discard.isPending}>
                {t('tt.discard')}
              </Button>
              <Button variant="contained" onClick={() => publish.mutate(current.id)} loading={publish.isPending}>
                {t('tt.publish')}
              </Button>
            </>
          )}
          {current?.status === 'published' && (
            <Button variant="outlined" onClick={() => setForkOpen(true)}>
              {t('tt.newVersion')}
            </Button>
          )}
        </Stack>
        {current?.status === 'published' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('tt.publishedHint')}
          </Typography>
        )}
        {(publish.isError || discard.isError || createFirst.isError) && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {errorMessage(publish.error ?? discard.error ?? createFirst.error, t)}
          </Alert>
        )}
      </Paper>
      {current && <VersionEditor classId={classId} version={current} />}
      {forkOpen && current && (
        <ForkDialog
          classId={classId}
          onClose={() => setForkOpen(false)}
          onCreated={async (id) => {
            await invalidate()
            setVersionId(id)
          }}
        />
      )}
    </Stack>
  )
}

function StatusTag({ v }: { v: Version }) {
  const { t } = useI18n()
  return <Tag tone={v.status === 'published' ? 'ok' : v.status === 'draft' ? 'warn' : 'neutral'} label={t(`tt.status.${v.status}`)} />
}

function VersionEditor({ classId, version }: { classId: string; version: Version }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const { days, start, end } = useSchoolDays()
  const slots = useQuery(slotsQuery(ctx.school.id, version.id))
  const required = useQuery(requiredHoursQuery(ctx.school.id, classId))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const rooms = useQuery(roomsQuery(ctx.school.id))
  const names = useQuery(membersNamesQuery(ctx.school.id))
  const [edit, setEdit] = useState<Partial<Slot> | null>(null)
  const editable = version.status === 'draft'

  const subjectName = (id: string | null) => subjects.data?.find((s) => s.id === id)?.name
  const dayNames = t('setup.dayNames').split(',')
  const labels = Object.fromEntries(days.map((d) => [d, dayNames[d - 1]]))

  const placed = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of slots.data ?? []) if (s.subject_id) m.set(s.subject_id, (m.get(s.subject_id) ?? 0) + toMin(s.ends_at) - toMin(s.starts_at))
    return m
  }, [slots.data])

  if (slots.isPending) return <Loading rows={4} />

  const blocks: Block[] = (slots.data ?? []).map((s) => ({
    key: s.id,
    weekday: s.weekday,
    start: s.starts_at,
    end: s.ends_at,
    title: s.title || subjectName(s.subject_id) || '—',
    lines: [names.data?.[s.teacher_member_id ?? ''] ?? '', rooms.data?.find((r) => r.id === s.room_id)?.name ?? ''].filter(Boolean),
    color: subjectColor(s.subject_id),
    onClick: editable ? () => setEdit(s) : undefined,
  }))

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 300px' } }}>
      <Stack spacing={1.5}>
        {editable && (
          <Button startIcon={<AddOutlined />} variant="outlined" onClick={() => setEdit({ weekday: days[0], starts_at: start, ends_at: '' })} sx={{ alignSelf: 'flex-start' }}>
            {t('tt.addSlot')}
          </Button>
        )}
        <WeekGrid days={days} dayLabels={labels} blocks={blocks} dayStart={start} dayEnd={end} emptyText={t('tt.emptyVersion')} />
      </Stack>
      <Paper variant="outlined" sx={{ p: 2, alignSelf: 'start' }}>
        <Typography variant="h5" sx={{ mb: 1.5 }}>
          {t('tt.coverage')}
        </Typography>
        {(required.data ?? []).length === 0 && <Typography color="text.secondary">{t('classes.noHours')}</Typography>}
        <Stack spacing={1.25}>
          {(required.data ?? []).map((r) => {
            const p = placed.get(r.subject_id!) ?? 0
            const pct = Math.min(100, (p / (r.weekly_minutes || 1)) * 100)
            return (
              <Box key={r.subject_id}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{subjectName(r.subject_id)}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: p >= (r.weekly_minutes ?? 0) ? tokens.accentDark : tokens.inkMuted }}>
                    {formatMinutes(p, locale)} / {formatMinutes(r.weekly_minutes ?? 0, locale)}
                  </Typography>
                </Stack>
                <LinearProgress variant="determinate" value={pct} sx={{ height: 5, borderRadius: 3, mt: 0.5 }} />
              </Box>
            )
          })}
        </Stack>
      </Paper>
      {edit && <SlotDialog classId={classId} version={version} slot={edit} onClose={() => setEdit(null)} />}
    </Box>
  )
}

function SlotDialog({
  classId,
  version,
  slot,
  onClose,
}: {
  classId: string
  version: Version
  slot: Partial<Slot>
  onClose: () => void
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const { days } = useSchoolDays()
  const required = useQuery(requiredHoursQuery(ctx.school.id, classId))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const teachers = useQuery(teachersQuery(ctx.school.id))
  const assignments = useQuery(assignmentsQuery(ctx.school.id, classId))
  const rooms = useQuery(roomsQuery(ctx.school.id))
  const [weekday, setWeekday] = useState(slot.weekday ?? 1)
  const [startsAt, setStartsAt] = useState(hhmm(slot.starts_at) || '08:30')
  const [endsAt, setEndsAt] = useState(hhmm(slot.ends_at) || '')
  const [subjectId, setSubjectId] = useState(slot.subject_id ?? '')
  const [teacherId, setTeacherId] = useState(slot.teacher_member_id ?? '')
  const [roomId, setRoomId] = useState(slot.room_id ?? '')
  const [title, setTitle] = useState(slot.title ?? '')
  const dayNames = t('setup.dayNames').split(',')

  // Choosing a subject pre-fills the teacher from "qui enseigne quoi".
  const pickSubject = (id: string) => {
    setSubjectId(id)
    const a = assignments.data?.find((x) => x.subject_id === id)
    if (a) setTeacherId(a.teacher_member_id)
    if (!endsAt) {
      const r = required.data?.find((x) => x.subject_id === id)
      const len = r?.max_session_minutes ?? 60
      const m = toMin(startsAt) + Math.min(len, 60)
      setEndsAt(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
    }
  }

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-slots', version.id] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-week'] }),
    ])

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        weekday,
        starts_at: startsAt,
        ends_at: endsAt,
        subject_id: subjectId || null,
        teacher_member_id: teacherId || null,
        room_id: roomId || null,
        title: title || null,
      }
      if (slot.id) must(await supabase.from('timetable_slots').update(row).eq('id', slot.id))
      else
        must(
          await supabase
            .from('timetable_slots')
            .insert({ ...row, school_id: ctx.school.id, class_id: classId, version_id: version.id }),
        )
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('timetable_slots').delete().eq('id', slot.id!)),
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const classSubjects = (required.data ?? []).map((r) => r.subject_id)
  const options = (subjects.data ?? []).filter((s) => classSubjects.includes(s.id))

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogTitle>{slot.id ? t('tt.editSlot') : t('tt.addSlot')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label={t('classes.subject')} value={subjectId} onChange={(e) => pickSubject(e.target.value)} required>
              {options.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label={t('tt.day')} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} fullWidth>
                {days.map((d) => (
                  <MenuItem key={d} value={d}>
                    {dayNames[d - 1]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="time"
                label={t('setup.start')}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 300 } }}
                fullWidth
                required
              />
              <TextField
                type="time"
                label={t('setup.end')}
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 300 } }}
                fullWidth
                required
              />
            </Stack>
            <TextField select label={t('classes.teacher')} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              <MenuItem value="">—</MenuItem>
              {(teachers.data ?? []).map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('tt.roomOverride')}
              helperText={t('tt.roomOverrideHint')}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <MenuItem value="">—</MenuItem>
              {(rooms.data ?? []).map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField label={t('tt.slotTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
            {(save.isError || remove.isError) && <Alert severity="error">{errorMessage(save.error ?? remove.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          {slot.id && (
            <Button color="error" onClick={() => remove.mutate()} loading={remove.isPending} sx={{ marginInlineEnd: 'auto' }}>
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={!subjectId || !startsAt || !endsAt}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function ForkDialog({
  classId,
  onClose,
  onCreated,
}: {
  classId: string
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const [from, setFrom] = useState(todayIso() < (ctx.year?.starts_on ?? '') ? ctx.year!.starts_on : todayIso())
  const [name, setName] = useState('')
  const fork = useMutation({
    mutationFn: async () =>
      must(
        await supabase.rpc('fork_timetable_version', {
          p_class_id: classId,
          p_from: from,
          p_name: name || t('tt.changeFrom', { date: formatDate(from, locale) }),
        }),
      ) as string,
    onSuccess: async (id) => {
      await onCreated(id)
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tt.newVersion')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('tt.forkHint')}
          </Typography>
          <TextField type="date" label={t('tt.fromDate')} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tt.changeFrom', { date: formatDate(from, locale) })} />
          {fork.isError && <Alert severity="error">{errorMessage(fork.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => fork.mutate()} loading={fork.isPending}>
          {t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
